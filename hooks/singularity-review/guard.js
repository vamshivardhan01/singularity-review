#!/usr/bin/env node
// Singularity Review — PreToolUse(Bash) hook. The ONLY place a hard deny is technically
// possible in this system (PostToolUse et al. can't block — the tool already
// ran). Denies a small, deliberately short list of genuinely dangerous,
// hard-to-reverse infra commands. Everything else in this system is
// advisory — this is the one exception, and it stays narrow on purpose.
//
// Coexists with the existing PreToolUse(Bash) → "rtk hook claude" entry —
// this is an ADDITIONAL matcher block, not a replacement.

const fs = require('fs');
const path = require('path');
const { readStdinJSON, emitDeny, stripQuotedForMatch } = require('./lib');

// Splits a (already quote-stripped) command string into naive shell tokens.
// Good enough for flag/positional-arg detection on the small set of
// commands this hook cares about — not a full shell parser, doesn't need
// to be since stripQuotedForMatch already removed quoted content.
//
// Operators are space-padded before splitting so they tokenize as their own
// token even with no surrounding whitespace — `-auto-approve;` and
// `plan&&rm` both split correctly, not just the space-delimited form
// (`-auto-approve ; echo`). Confirmed via reproduction that the whitespace-
// only version had a real gap here, not just a documented edge case: `;`
// glued directly to the preceding word (`terraform apply -auto-approve;
// echo tfplan` — the common, no-space way people actually write `;`-chains)
// stayed part of the `-auto-approve;` token, which `startsWith('-')`
// treated as "just a flag" and skipped past, then read `echo` as the plan
// file and wrongly allowed the apply.
function tokenize(cmd) {
  return cmd.replace(/(&&|\|\||[;&|])/g, ' $1 ').split(/\s+/).filter(Boolean);
}

// Shell control/pipe operators — a token equal to one of these ends the
// current command; anything after it is a separate command, never a
// positional argument to what came before. Needed because `terraform apply
// && rm tfplan` would otherwise read the literal token `&&` as the first
// non-flag token after `apply` and wrongly conclude a plan-file argument
// was supplied.
const SHELL_OPERATOR_TOKENS = new Set(['&&', '||', ';', '|', '&']);

// True if `terraform apply` in this command has a plan-file positional
// argument (the saved-plan pattern: `terraform apply tfplan`, `terraform
// apply out.tfplan`), as opposed to a bare `terraform apply` / `terraform
// apply -auto-approve` / `terraform apply -var-file=foo.tfvars`, which
// re-plans and applies unreviewed.
// Rule: after `apply`, the first token that doesn't start with `-` is
// treated as the plan-file positional — UNLESS a shell operator token is
// encountered first, which ends the `apply` invocation with zero arguments
// (correctly treated as a bare apply, not as having a plan file named
// "&&"/";"/etc.).
function terraformApplyHasPlanArg(matchTarget) {
  return extractApplyPlanFile(matchTarget) !== null;
}

// Returns the plan-file token itself (not just whether one exists), or null.
// Same walk as terraformApplyHasPlanArg, just returning the token instead of
// a boolean — used by the staleness check below, which needs the actual
// filename to stat.
function extractApplyPlanFile(matchTarget) {
  const tokens = tokenize(matchTarget);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === 'terraform' && tokens[i + 1] === 'apply') {
      for (let j = i + 2; j < tokens.length; j++) {
        if (SHELL_OPERATOR_TOKENS.has(tokens[j])) return null; // command ended, no plan arg
        if (tokens[j].startsWith('-')) continue; // flag, not a plan file
        return tokens[j]; // first non-flag positional token after `apply`
      }
      return null;
    }
  }
  return null; // no `terraform apply` found — caller's outer test already excludes this
}

// Deny `terraform apply <planfile>` when the plan is STALE — real on disk,
// but generated before the `.tf` files it supposedly plans against last
// changed, so it no longer reflects current config. Scoped to this exact
// gap, not general existence-checking: a genuinely nonexistent plan file is
// already safe by construction (Terraform itself hard-errors with "no such
// file" rather than silently proceeding), so this only fires on the case
// Terraform's own error can't catch — a real, stale plan.
//
// Considered an agent-type hook for this (see research/findings.md Pass 4)
// and rejected it: staleness is an mtime comparison, not a judgment call —
// a deterministic check answers it for free, faster, without depending on
// a mechanism Anthropic's own docs mark experimental and say to avoid in
// production. Not a full shell parser here either: only checks the plan
// file's own directory for sibling `.tf` files, mirroring how `terraform
// plan -out=` is actually used (from the module root being planned).
function isStalePlanFile(planFile, cwd) {
  if (!cwd) return false; // no cwd on stdin — can't resolve relative paths, don't guess
  const resolved = path.isAbsolute(planFile) ? planFile : path.join(cwd, planFile);
  let planStat;
  try { planStat = fs.statSync(resolved); } catch (e) { return false; } // doesn't exist — Terraform's own error handles this, not our job
  const dir = path.dirname(resolved);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return false; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.tf')) continue;
    let tfStat;
    try { tfStat = fs.statSync(path.join(dir, entry.name)); } catch (e) { continue; }
    if (tfStat.mtimeMs > planStat.mtimeMs) return true; // a .tf file changed after the plan was generated
  }
  return false;
}

// [pattern-or-predicate, reason] — checked against the command string with
// quoted substrings stripped out first (see stripQuotedForMatch in lib.js),
// so a trigger phrase sitting inside a string literal/echo/grep
// pattern/doc path doesn't false-positive. Real invocations are unquoted at
// the command-name position, so this doesn't weaken the actual deny.
// Predicate functions receive (matchTarget, cwd) — cwd is only used by the
// staleness check; every other predicate ignores its second argument.
const DENY_RULES = [
  [/\bterraform\s+destroy\b/, 'terraform destroy is blocked by guard.js. Run `blast-radius.sh` on a plan first, confirm with the user explicitly, then run destroy outside this hook path if truly intended.'],
  [(mt) => /\bterraform\s+apply\b/.test(mt) && !terraformApplyHasPlanArg(mt),
    'terraform apply without a saved plan file is blocked. Run `terraform plan -out=tfplan` and `blast-radius.sh` first, then `terraform apply tfplan`.'],
  [(mt, cwd) => {
      const planFile = extractApplyPlanFile(mt);
      return planFile !== null && isStalePlanFile(planFile, cwd);
    },
    'terraform apply is blocked — the referenced plan file predates a .tf change in its directory, so it no longer reflects current config. Run `terraform plan -out=tfplan` again and `blast-radius.sh` before applying.'],
  [/\bkubectl\s+delete\s+(ns|namespace)\b/, 'kubectl delete namespace is blocked by guard.js — deletes everything in it. Confirm explicitly with the user and run manually if truly intended.'],
  [/\bkubectl\s+delete\s+(pv|persistentvolume|pvc|persistentvolumeclaim)\b/, 'kubectl delete on a PV/PVC is blocked — likely irreversible data loss. Confirm explicitly with the user first.'],
  // Force-push to main/master, regardless of flag form (`-f`, `--force`,
  // `--force-with-lease[=...]`) or whether the flag comes before or after
  // the branch name — both `git push -f origin main` and
  // `git push origin main --force` match.
  [(mt) => /\bgit\s+push\b/.test(mt)
      && /(^|\s)(-f|--force|--force-with-lease(?:=\S*)?)(\s|$)/.test(mt)
      && /(^|\s)(origin\s+|upstream\s+)?(main|master)(\s|$)/.test(mt),
    'force-push to main/master is blocked. Confirm explicitly with the user; this can overwrite others\' work.'],
  [/\bargocd\s+app\s+delete\b/, 'argocd app delete is blocked by guard.js. Confirm explicitly with the user — this can prune every resource the Application owns.'],
  [/\baws\s+s3\s+rb\b/, 'aws s3 rb (remove bucket) is blocked by guard.js. Confirm explicitly with the user first.'],
  [/\bterraform\s+state\s+(rm|push|mv)\b/, 'terraform state rm/push/mv is blocked by guard.js — can orphan a resource from state (rm) or overwrite remote state wholesale (push), both hard to reverse. Confirm explicitly with the user and pair with an audited PR per references/terraform.md.'],
  [/\brm\s+.*-[a-z]*r[a-z]*f[a-z]*\b.*\.terraform\b/, 'rm -rf on a .terraform directory is blocked by guard.js — destroys the local provider/module cache and, if it also holds local backend state, the state itself. Confirm explicitly with the user first.'],
  [/\brm\s+.*-[a-z]*f[a-z]*r[a-z]*\b.*\.terraform\b/, 'rm -rf (flag order -fr) on a .terraform directory is blocked by guard.js — see terraform-state rule above. Confirm explicitly with the user first.'],
  [/\brm\s+[^|;&]*\.tfstate\b/, 'rm targeting a .tfstate file is blocked by guard.js — direct deletion of Terraform state, not reversible without a backup. Confirm explicitly with the user first.'],
];

readStdinJSON().then(data => {
  const cmd = (data.tool_input && data.tool_input.command) || '';
  if (!cmd) { process.exit(0); }
  const matchTarget = stripQuotedForMatch(cmd);

  for (const [rule, reason] of DENY_RULES) {
    const hit = typeof rule === 'function' ? rule(matchTarget, data.cwd) : rule.test(matchTarget);
    if (hit) {
      emitDeny(reason);
      return;
    }
  }
  process.exit(0); // no rule matched — allow, silent, zero tokens
}).catch(() => { process.exit(0); });
