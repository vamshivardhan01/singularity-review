#!/usr/bin/env node
// Singularity Review — UserPromptSubmit hook. Fires on EVERY turn but only EMITS when the
// detected stack actually changed since charter-inject.js last recorded it
// (e.g. cd from a Terraform repo to a Helm repo mid-session). Every other
// turn this is a single stat()+readFileSync comparison — zero tokens.
// This is the one legitimate per-turn hook pattern per the research: state-
// change-gated, never blind re-injection.

const { readStdinJSON, detectStack, readState, writeState } = require('./lib');

readStdinJSON().then(data => {
  const cwd = data.cwd || process.cwd();
  const sessionId = data.session_id;
  if (!sessionId) { process.exit(0); }

  const stack = detectStack(cwd);
  if (stack === 'none') { process.exit(0); }

  const last = readState('stack', sessionId);
  if (last === stack) { process.exit(0); } // no change — zero-token exit

  writeState('stack', sessionId, stack);

  // First time this session (charter-inject didn't fire, e.g. resumed mid-repo-nav)
  // still worth one injection; genuine switches always worth one.
  const { emitAdditionalContext } = require('./lib');
  emitAdditionalContext('UserPromptSubmit',
    'Stack changed to: ' + stack + '. Load the matching reference file (references/' +
    (stack === 'terraform' ? 'terraform.md' : stack === 'helm' ? 'helm-k8s.md' :
     stack === 'gitops' ? 'argocd-gitops.md' : stack === 'aws-iam' ? 'aws-org-iam.md' : 'none') +
    ') via building-platform-code or reviewing-platform-code, not the previous stack\'s.');
}).catch(() => { process.exit(0); });
