#!/usr/bin/env node
// Singularity Review — SessionStart hook. Injects the platform-quality charter pointer ONCE
// per session/reset (matcher: startup|resume|clear|compact), same cadence as
// CLAUDE.md itself. Never on UserPromptSubmit — see plan doc for why
// (prompt caching does not reduce context-window size, only $ cost; the only
// real fix is not re-sending the tokens every turn).
//
// Deliberately a ~800-char POINTER, not the full taxonomy — the skill loads
// the actual reference file on demand, stack-partitioned.

const { readStdinJSON, detectStack, writeState } = require('./lib');

readStdinJSON().then(data => {
  const cwd = data.cwd || process.cwd();
  const stack = detectStack(cwd);

  if (stack === 'none') { process.exit(0); }

  // record so stack-switch-inject.js only fires on an actual mid-session change
  if (data.session_id) writeState('stack', data.session_id, stack);

  const pointer =
    'SINGULARITY REVIEW ACTIVE — infra stack detected: ' + stack + '.\n' +
    'Quality dimensions: Security, Architecture, Scalability, Composability, Reliability, Testability, Code Clarity.\n' +
    'Four review lenses (apply at design time, not just review time): Platform Engineer (blast radius/state/drift/rollback), ' +
    'Solutions Architect (contracts/coupling/migration story), DevOps-SRE (rollback/probes/observability/toil), ' +
    'Backend Engineer (idempotency/error semantics/concurrency).\n' +
    'Writing or changing .tf/Chart.yaml/values.yaml/kustomization/ArgoCD Application/IAM → use the building-platform-code skill. ' +
    'Reviewing such a change, or about to apply/sync/destroy something → use the reviewing-platform-code skill (extreme, oracle-backed, not the generic /review). ' +
    'Both load only the one relevant reference file for the detected stack — never dump the full taxonomy into this context.\n' +
    'Mechanical checks (syntax/schema/lint/plan-diff) are always a tool call, never manual read-and-judge — see references/scanners.md delegation law.';

  process.stdout.write(pointer);
}).catch(() => { process.exit(0); });
