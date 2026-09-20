#!/usr/bin/env node
// Singularity Review — UserPromptSubmit hook. State-gated like stack-switch-inject.js: reads
// the ledger mistake-ledger.js wrote, computes a drift level, and only emits
// when the level has escalated past what was last notified — never repeats
// the same warning every turn once past threshold.

const { readStdinJSON, readLedger, readState, writeState, emitAdditionalContext } = require('./lib');

function computeLevel(entries) {
  const failures = entries.filter(e => e.kind === 'failure').length;
  const edits = entries.filter(e => e.kind === 'edit');
  const churnByFile = {};
  for (const e of edits) { churnByFile[e.target] = (churnByFile[e.target] || 0) + 1; }
  const maxChurn = Math.max(0, ...Object.values(churnByFile));
  const churnFile = Object.keys(churnByFile).find(f => churnByFile[f] === maxChurn) || '';

  let level = 0;
  if (failures >= 10 || maxChurn >= 6) level = 2;
  else if (failures >= 5 || maxChurn >= 4) level = 1;

  return { level, failures, maxChurn, churnFile };
}

readStdinJSON().then(data => {
  const sessionId = data.session_id;
  if (!sessionId) { process.exit(0); }

  const entries = readLedger(sessionId);
  if (entries.length === 0) { process.exit(0); }

  const { level, failures, maxChurn, churnFile } = computeLevel(entries);
  const lastNotified = parseInt(readState('drift-level', sessionId) || '0', 10);

  if (level <= lastNotified) { process.exit(0); } // no escalation — zero-token exit

  writeState('drift-level', sessionId, level);

  const churnNote = maxChurn > 0 ? `, ${maxChurn} edits on \`${churnFile}\`` : '';
  const msg = level === 2
    ? `SESSION DRIFT (high): ${failures} tool failures${churnNote} this session. ` +
      `Strongly consider running the handing-off-context skill and starting a fresh session — ` +
      `repeated churn on the same file is the strongest signal this session is stuck.`
    : `SESSION DRIFT (notice): ${failures} tool failures${churnNote} this session. ` +
      `Worth a beat to reconsider approach; handing-off-context is available if it keeps climbing.`;

  emitAdditionalContext('UserPromptSubmit', msg);
}).catch(() => { process.exit(0); });
