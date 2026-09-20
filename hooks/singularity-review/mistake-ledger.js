#!/usr/bin/env node
// Singularity Review — PostToolUseFailure + PostToolUse hook. Write-only, zero tokens.
// Appends failures and edit-churn to a per-session ledger that drift-watch.js
// reads to decide whether to suggest a fresh session, and that
// handing-off-context reads to write the handoff doc. Never prints anything
// on success — silence is the correct zero-token behavior.

const { readStdinJSON, appendLedger } = require('./lib');

readStdinJSON().then(data => {
  const sessionId = data.session_id;
  if (!sessionId) { process.exit(0); }

  const isFailure = data.hook_event_name === 'PostToolUseFailure';
  const toolName = data.tool_name || '';
  const isEdit = toolName === 'Write' || toolName === 'Edit';

  if (isFailure) {
    appendLedger(sessionId, {
      kind: 'failure',
      tool: toolName,
      target: (data.tool_input && (data.tool_input.file_path || data.tool_input.command)) || '',
    });
  } else if (isEdit) {
    // Edit-churn signal: repeated Write/Edit on the same file is the
    // strongest "agent is lost" indicator — stronger than raw failure count.
    appendLedger(sessionId, {
      kind: 'edit',
      tool: toolName,
      target: (data.tool_input && data.tool_input.file_path) || '',
    });
  }
  // Any other successful tool use: nothing to log, exit silent.
  process.exit(0);
}).catch(() => { process.exit(0); });
