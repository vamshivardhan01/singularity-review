// Shared helpers for the Singularity Review hooks. Kept dependency-free (node stdlib only)
// to match the existing caveman hooks in this install.

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const STATE_DIR = path.join(CLAUDE_DIR, 'state');

function ensureStateDir() {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch (e) {}
}

// Directories never worth descending into for stack detection — either huge
// (blowing up scan time) or definitionally not where a project's own IaC
// markers live.
const SCAN_SKIP_DIRS = new Set([
  'node_modules', '.git', '.terraform', 'vendor', 'dist', 'build',
  '.venv', 'venv', '__pycache__', '.cache', 'target', '.next', '.turbo',
]);

function listSafe(d) { try { return fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return []; } }

function markersAt(d) {
  const entries = listSafe(d);
  if (entries.some(e => e.isFile() && e.name.endsWith('.tf'))) {
    return /\b(scp|identity-center|iam)\b/i.test(d) ? 'aws-iam' : 'terraform';
  }
  if (entries.some(e => e.isFile() && e.name === 'Chart.yaml')) return 'helm';
  if (entries.some(e => e.isFile() && (e.name === 'kustomization.yaml' || e.name === 'kustomization.yml'))) return 'gitops';
  return 'none';
}

// Walks upward from `dir` looking for a `.git` entry (dir for a normal repo,
// file for a worktree) — the portable, non-hardcoded way to answer "is this
// actually a project" before spending any effort scanning it. Confirmed
// necessary, not just defensive: a bare /tmp scratch dir can accumulate real
// .tf files from unrelated work (a leftover `git worktree` checkout did
// exactly this during testing) — bounded-depth scanning alone would have
// false-positived on it. A worktree there is legitimately detected because
// it has its own `.git` file; plain scratch content is correctly ignored
// because it doesn't.
function findGitRoot(dir, maxUp = 8) {
  let cur = dir;
  for (let i = 0; i <= maxUp; i++) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null; // reached filesystem root
    cur = parent;
  }
  return null;
}

// No hardcoded repo list — this needs to work in any org's repos, not a
// fixed set. detectStack(dir):
//   1. Never treat $HOME itself as a project.
//   2. Require a git root — see findGitRoot above.
//   3. Walk upward from dir to the git root, checking markers at each level
//      (handles a repo whose own markers sit at an ancestor of cwd, e.g. a
//      subdirectory like foundation/scps/ that has no .tf of its own — the
//      actual .tf files are at the repo root).
//   4. If nothing found on that direct path, bounded-depth (5) scan
//      downward FROM THE GIT ROOT — not from an arbitrary cwd — so markers
//      living in an unrelated subtree (charts/<name>/, accounts/<name>/)
//      still get found without an unbounded walk of the whole tree.
function detectStack(dir) {
  if (!dir || dir === os.homedir()) return 'none';

  const gitRoot = findGitRoot(dir);
  if (!gitRoot) return 'none';

  let cur = dir;
  while (true) {
    const found = markersAt(cur);
    if (found !== 'none') return found;
    if (cur === gitRoot) break;
    cur = path.dirname(cur);
  }

  const MAX_DEPTH = 5;
  function scanDown(d, depth) {
    const found = markersAt(d);
    if (found !== 'none') return found;
    if (depth >= MAX_DEPTH) return 'none';
    for (const e of listSafe(d)) {
      if (!e.isDirectory() || e.name.startsWith('.') || SCAN_SKIP_DIRS.has(e.name)) continue;
      const r = scanDown(path.join(d, e.name), depth + 1);
      if (r !== 'none') return r;
    }
    return 'none';
  }
  return scanDown(gitRoot, 0);
}

function statePath(name, sessionId) {
  return path.join(STATE_DIR, `sr-${name}-${sessionId || 'nosession'}`);
}

function readState(name, sessionId) {
  try { return fs.readFileSync(statePath(name, sessionId), 'utf8').trim(); } catch (e) { return null; }
}

function writeState(name, sessionId, value) {
  ensureStateDir();
  try { fs.writeFileSync(statePath(name, sessionId), String(value)); } catch (e) {}
}

function ledgerPath(sessionId) {
  return path.join(STATE_DIR, `sr-ledger-${sessionId || 'nosession'}.jsonl`);
}

// Rotation cap: drift-watch.js's own thresholds top out at failures>=10 /
// maxChurn>=6 (see drift-watch.js computeLevel) — recent history is all it
// ever needs. A very long single session with heavy churn would otherwise
// grow this file unbounded until install.sh's next 30-day mtime prune.
// Byte-size check first (cheap stat, no read) so the common case — a
// small ledger — costs nothing beyond the append itself; only once the
// file is plausibly over the line count does this pay for a full read.
const LEDGER_MAX_LINES = 500;
const LEDGER_ROTATE_KEEP = 250; // trim to this many most-recent lines when cap is hit
// Byte-size fast path before paying for a full read. Estimate deliberately
// low (40B/line, real entries run ~60-90B) so the check errs toward reading
// too often rather than missing rotation — a wasted stat+read is cheap, an
// unbounded ledger is the bug being fixed.
const LEDGER_SIZE_CHECK_BYTES = LEDGER_MAX_LINES * 40;

function rotateLedgerIfNeeded(p) {
  let stat;
  try { stat = fs.statSync(p); } catch (e) { return; }
  if (stat.size < LEDGER_SIZE_CHECK_BYTES) return; // zero-token fast path, no read
  let lines;
  try { lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean); } catch (e) { return; }
  if (lines.length <= LEDGER_MAX_LINES) return;
  const kept = lines.slice(-LEDGER_ROTATE_KEEP);
  try { fs.writeFileSync(p, kept.join('\n') + '\n'); } catch (e) {}
}

// Cross-process lock for the rotate+append sequence. Each hook invocation is
// a separate short-lived Node process — PostToolUseFailure and
// PostToolUse(Write|Edit) can fire for closely-timed tool calls with no
// shared in-memory state, so a rotate's truncating writeFileSync can race an
// append from another process (truncate-during-append / lost-append hazard).
// `wx` is atomic exclusive-create at the OS level: only one process can hold
// the lock file at a time, the rest retry briefly. A stale lock (crashed
// process) is reclaimed after LOCK_STALE_MS so a crash can't wedge future
// writes permanently.
const LOCK_STALE_MS = 5000;
const LOCK_RETRY_MS = 15;
const LOCK_MAX_WAIT_MS = 500;

function acquireLock(lockPath) {
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') return false; // unexpected error — don't spin
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > LOCK_STALE_MS) { try { fs.unlinkSync(lockPath); } catch (e2) {} continue; }
      } catch (e2) { /* lock disappeared between check and stat — retry */ }
      const until = Date.now() + LOCK_RETRY_MS;
      while (Date.now() < until) { /* brief busy-wait, no sleep primitive in sync Node */ }
    }
  }
  return false; // couldn't acquire — caller falls back to unlocked append
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch (e) {}
}

function appendLedger(sessionId, entry) {
  ensureStateDir();
  const p = ledgerPath(sessionId);
  const lockPath = p + '.lock';
  const line = JSON.stringify({ t: Date.now(), ...entry }) + '\n';
  const locked = acquireLock(lockPath);
  try {
    rotateLedgerIfNeeded(p);
    fs.appendFileSync(p, line);
  } catch (e) {
    // ignore
  } finally {
    if (locked) releaseLock(lockPath);
  }
}

function readLedger(sessionId) {
  try {
    return fs.readFileSync(ledgerPath(sessionId), 'utf8')
      .split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
  } catch (e) { return []; }
}

// Removes shell quote CHARACTERS while preserving the underlying text, so
// ordinary quoted arguments (`git commit -m "msg"`, `kubectl delete
// "namespace" foo`, `git push -f "origin" "main"`) still match DENY_RULES
// against their real command content — quoting a word is completely
// standard shell usage and must not be a bypass for the one hard-deny path
// in this system.
//
// Separately, and only for the small set of constructs where quoted text is
// genuinely DATA rather than a token of the command being run (a string
// literal passed to `node -e`, `python -c`, `echo`, or as a `grep`/`rg`
// pattern) — the quoted span is blanked out instead, so inert example text
// like `node -e "console.log('terraform destroy')"` or
// `echo "would run: terraform destroy"` doesn't false-positive.
// eval/bash -c/sh -c/zsh -c are treated as normal (quotes preserved as
// text), since the quoted content there IS the command that will run.
//
// This intentionally does NOT special-case grep/rg pattern *matching*
// beyond blanking their quoted argument — a real invocation's command name
// and flags are never inside quotes at the position DENY_RULES checks, so
// preserving quoted text as plain text does not weaken real detections.
const DATA_ARG_COMMANDS = /\b(?:node\s+-e|python[0-9.]*\s+-c|echo|printf|grep|egrep|fgrep|rg)\b/;
const QUOTED = String.raw`("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`;

function blank(quoted) { return quoted[0] === '"' ? '""' : "''"; }

function stripQuotedForMatch(cmd) {
  if (/\b(eval|bash\s+-c|sh\s+-c|zsh\s+-c)\b/.test(cmd)) return cmd;

  // Blank out quoted spans that follow one of the data-consuming
  // constructs above — these are the only genuinely-inert cases.
  // `(?:\s+-\S+)*` allows flags between the command and its quoted
  // argument (`grep -i "..."`, `grep -rn "..."`) — a real, reproduced gap
  // when this only matched the command name immediately adjacent to the
  // quote, which real-world grep/rg usage almost never is.
  let out = cmd.replace(
    new RegExp(DATA_ARG_COMMANDS.source + String.raw`(?:\s+-\S+)*\s*` + QUOTED, 'g'),
    (whole, quoted) => whole.slice(0, whole.length - quoted.length) + blank(quoted)
  );

  // -m/--message is data regardless of which command it's attached to
  // (git commit/tag/merge/rebase, etc.) — a human-readable message, never
  // code or an argument DENY_RULES should read as part of the invocation.
  // Reproduced gap: this repo's own commit messages describe the deny
  // rules by name ("terraform destroy is blocked..."), so `git commit -m
  // "..."` was denying ordinary commits before this rule existed.
  out = out.replace(
    new RegExp(String.raw`(-m|--message)(=|\s+)` + QUOTED, 'g'),
    (whole, flag, sep, quoted) => flag + sep + blank(quoted)
  );

  // Everywhere else, strip the quote characters but keep the text inside —
  // an ordinary quoted argument still matches DENY_RULES against its real
  // content.
  out = out.replace(/"([^"\\]|\\.)*"/g, (m) => m.slice(1, -1)).replace(/'([^'\\]|\\.)*'/g, (m) => m.slice(1, -1));
  return out;
}

function readStdinJSON() {
  return new Promise(resolve => {
    let input = '';
    process.stdin.on('data', c => { input += c; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(input)); } catch (e) { resolve({}); }
    });
  });
}

function emitAdditionalContext(eventName, text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: text },
  }));
}

function emitDeny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

module.exports = {
  CLAUDE_DIR, STATE_DIR,
  detectStack,
  statePath, readState, writeState,
  ledgerPath, appendLedger, readLedger,
  readStdinJSON, emitAdditionalContext, emitDeny, stripQuotedForMatch,
};
