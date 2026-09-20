#!/usr/bin/env node
// Singularity Review — PostToolUse(Write|Edit) hook. Fast feedback loop: after writing an
// infra file, run only the FAST subset (fmt/validate/yamllint) — never full
// checkov/trivy here, that belongs in the skill's explicit scan step, not a
// hook that fires on every single file write. PostToolUse can't block (tool
// already ran) but its stderr reaches Claude, so failures surface immediately
// without costing a full skill invocation.
//
// Debounced per-file: skips if this exact file was checked in the last 30s,
// so a burst of small edits to the same file doesn't re-run the check on each one.

const { execFile } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const { readStdinJSON, readState, writeState } = require('./lib');

const EXT_CHECKS = {
  '.tf': (file, cb) => execFile('terraform', ['fmt', '-check', file], cb),
  '.yaml': (file, cb) => execFile('yamllint', [file], cb),
  '.yml': (file, cb) => execFile('yamllint', [file], cb),
};

readStdinJSON().then(data => {
  const filePath = (data.tool_input && data.tool_input.file_path) || '';
  const sessionId = data.session_id || 'nosession';
  if (!filePath) { process.exit(0); }

  const ext = path.extname(filePath);
  const check = EXT_CHECKS[ext];
  if (!check) { process.exit(0); } // not an infra file this hook covers

  // Full sha1 hex digest, not a truncated base64 prefix — the previous
  // truncation collided on any two paths sharing a long-enough common
  // prefix (e.g. main.tf vs main2.tf under the same directory), silently
  // debouncing the wrong file's check.
  const debounceKey = 'scanwrite-' + crypto.createHash('sha1').update(filePath).digest('hex');
  const last = parseInt(readState(debounceKey, sessionId) || '0', 10);
  const now = Date.now();
  if (now - last < 30000) { process.exit(0); } // debounced, zero-token exit
  writeState(debounceKey, sessionId, now);

  check(filePath, (err, stdout, stderr) => {
    if (err) {
      // PostToolUse can't block — tool already ran — but stderr reaches
      // Claude, so it sees this without a separate scanner invocation.
      process.stderr.write(`[singularity-review scan-on-write] ${ext} check failed for ${filePath}:\n${stderr || stdout || err.message}\n`);
    }
    process.exit(0);
  });
}).catch(() => { process.exit(0); });
