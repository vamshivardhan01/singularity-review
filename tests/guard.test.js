#!/usr/bin/env node
// Regression table for guard.js's DENY_RULES / stripQuotedForMatch /
// evaluateCommand. No framework (matches this repo's Node-stdlib-only
// convention) — a flat table of [command, cwd, expectedDecision, description].
//
// This exists because guard.js's matching logic is the exact code class that
// produced a P0 finding (every hard-deny rule bypassable via shell
// expansion) with zero test coverage to catch it.

const assert = require('assert');
const { evaluateCommand } = require('../hooks/singularity-review/guard.js');

// [command, cwd, expectedDecision ('deny'|'ask'|null), description]
const CASES = [
  // --- Original DENY_RULES: deny cases ---
  ['terraform destroy', null, 'deny', 'terraform destroy — bare'],
  ['terraform destroy -auto-approve', null, 'deny', 'terraform destroy with flag'],
  ['terraform apply', null, 'deny', 'terraform apply with no plan file'],
  ['terraform apply -auto-approve', null, 'deny', 'terraform apply -auto-approve, no plan file'],
  ['terraform apply -var-file=foo.tfvars', null, 'deny', 'terraform apply with only a var-file flag, still no plan file'],
  ['kubectl delete ns staging', null, 'deny', 'kubectl delete namespace (short form)'],
  ['kubectl delete namespace staging', null, 'deny', 'kubectl delete namespace (long form)'],
  ['kubectl delete pv my-pv', null, 'deny', 'kubectl delete pv'],
  ['kubectl delete pvc my-pvc', null, 'deny', 'kubectl delete pvc'],
  ['git push -f origin main', null, 'deny', 'force-push to main, -f before branch'],
  ['git push origin main --force', null, 'deny', 'force-push to main, --force after branch'],
  ['git push --force-with-lease origin master', null, 'deny', 'force-push to master with --force-with-lease'],
  ['argocd app delete my-app', null, 'deny', 'argocd app delete'],
  ['aws s3 rb s3://my-bucket', null, 'deny', 'aws s3 rb'],
  ['terraform state rm aws_instance.foo', null, 'deny', 'terraform state rm'],
  ['terraform state push errored.tfstate', null, 'deny', 'terraform state push'],
  ['rm -rf .terraform', null, 'deny', 'rm -rf .terraform'],
  ['rm -fr .terraform', null, 'deny', 'rm -fr .terraform (flag order swapped)'],
  ['rm terraform.tfstate', null, 'deny', 'rm targeting a .tfstate file'],

  // --- Original DENY_RULES: allow cases (should NOT match) ---
  ['terraform plan', null, null, 'terraform plan alone is fine'],
  ['terraform apply tfplan', null, null, 'terraform apply WITH a saved plan file is fine'],
  ['terraform apply out.tfplan', null, null, 'terraform apply with a named saved plan is fine'],
  ['kubectl delete pod my-pod', null, null, 'kubectl delete pod (not ns/pv) is fine'],
  ['kubectl get pv', null, null, 'kubectl get pv is fine'],
  ['git push origin feature-branch', null, null, 'normal push to a feature branch is fine'],
  ['git push origin main', null, null, 'push to main WITHOUT force is fine'],
  ['argocd app get my-app', null, null, 'argocd app get is fine'],
  ['aws s3 ls', null, null, 'aws s3 ls is fine'],
  ['rm -rf node_modules', null, null, 'rm -rf on an unrelated directory is fine'],
  ['git status', null, null, 'unrelated git command is fine'],

  // --- Pre-existing false-positive guards (quoted data args are inert) ---
  ['git commit -m "terraform destroy is blocked by guard.js"', null, null, 'commit message describing the rule is not a real invocation'],
  ['echo "would run: terraform destroy"', null, null, 'echo of inert display text is not a real invocation'],
  ['node -e "console.log(\'terraform destroy\')"', null, null, 'node -e string literal is data, not a command'],
  ['grep -rn "terraform destroy" .', null, null, 'grep pattern argument is data, not a command'],
  ['git commit -m "fix: terraform apply -f" && git push origin feature-x', null, null, 'glued semicolon/&& tokenization: message is data, push is to a feature branch'],

  // --- P0 bypass cases: shell expansion alongside a dangerous keyword now asks ---
  ['terraform $(echo destroy)', null, 'ask', 'command substitution hides the real subcommand'],
  ['terraform `echo destroy`', null, 'ask', 'backtick substitution hides the real subcommand'],
  ['V=destroy; terraform $V', null, 'ask', 'bare $VAR reference hides the real subcommand'],
  ['terraform ${ACTION}', null, 'ask', '${...} parameter expansion hides the real subcommand'],
  ['kubectl $(echo delete) ns staging', null, 'ask', 'expansion hides the verb itself, so the literal deny regex cannot match, but the keyword+expansion heuristic catches it'],
  ['echo "$(terraform destroy)"', null, 'ask', 'expansion nested inside a quoted echo argument still executes in a real shell'],

  // --- No false positive: expansion alone, without a dangerous keyword, is fine ---
  ['echo $(date)', null, null, 'expansion with no dangerous keyword present is fine'],
  ['ls $HOME/projects', null, null, '$VAR reference with no dangerous keyword is fine'],
];

let pass = 0, fail = 0;
for (const [cmd, cwd, expected, desc] of CASES) {
  const { decision } = evaluateCommand(cmd, cwd);
  const got = decision || null;
  const ok = got === expected;
  if (ok) { pass++; }
  else {
    fail++;
    console.error(`FAIL: ${desc}\n  command:  ${cmd}\n  expected: ${expected}\n  got:      ${got}`);
  }
}

console.log(`${pass} passed, ${fail} failed (${pass + fail} total)`);
if (fail > 0) process.exit(1);
