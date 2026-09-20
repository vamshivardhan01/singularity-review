#!/usr/bin/env node
'use strict';

// Idempotent installer for Singularity Review.
// Symlinks skills/agents/hooks from this package into ~/.claude, then merges
// (never overwrites) the hooks block in ~/.claude/settings.json.
// Safe to re-run — every step checks current state before acting.
// No dependencies: Node stdlib only.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const HERE = path.resolve(__dirname, '..');
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');

function isSymlink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

function linkDir(label, srcRel, targetRel) {
  const src = path.join(HERE, srcRel);
  const target = path.join(CLAUDE_DIR, targetRel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (isSymlink(target)) {
    if (fs.readlinkSync(target) === src) {
      console.log(`${label}  already linked`);
      return;
    }
    console.log(`${label}  SKIPPED — ${target} exists and is not our symlink, resolve manually`);
    return;
  }
  if (fs.existsSync(target)) {
    console.log(`${label}  SKIPPED — ${target} exists and is not our symlink, resolve manually`);
    return;
  }
  try {
    fs.symlinkSync(src, target, 'dir');
    console.log(`${label}  linked`);
  } catch (e) {
    console.log(`${label}  FAILED — ${e.message}`);
    if (process.platform === 'win32') {
      console.log('  Windows needs Developer Mode enabled, or run as Administrator, to create symlinks.');
    }
  }
}

console.log('== Singularity Review install ==');
console.log(`source: ${HERE}`);
console.log(`target: ${CLAUDE_DIR}`);
console.log('');

// --- 1. Symlink skills ---------------------------------------------------
for (const skill of ['building-platform-code', 'singularity-review', 'handing-off-context', 'posting-review-comments']) {
  linkDir(`skill  ${skill}`, path.join('skills', skill), path.join('skills', skill));
}

// --- 2. Symlink agents -----------------------------------------------------
linkDir('agents', 'agents', 'agents');

// --- 3. Symlink hooks/singularity-review ------------------------------------
linkDir('hooks/singularity-review', path.join('hooks', 'singularity-review'), path.join('hooks', 'singularity-review'));

fs.mkdirSync(path.join(CLAUDE_DIR, 'state'), { recursive: true });
fs.mkdirSync(path.join(CLAUDE_DIR, 'handoffs'), { recursive: true });

// Prune state files from sessions older than 30 days — nothing else does this.
try {
  const stateDir = path.join(CLAUDE_DIR, 'state');
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let pruned = 0;
  for (const f of fs.readdirSync(stateDir)) {
    if (!f.startsWith('sr-')) continue;
    const fp = path.join(stateDir, f);
    if (now - fs.statSync(fp).mtimeMs > THIRTY_DAYS_MS) {
      fs.unlinkSync(fp);
      pruned++;
    }
  }
  if (pruned > 0) console.log(`pruned ${pruned} stale state file(s) older than 30 days`);
} catch { /* state dir empty or unreadable — not fatal */ }

// --- 4. Merge hooks into settings.json (additive, idempotent) -------------
const SR_HOOKS = path.join(CLAUDE_DIR, 'hooks', 'singularity-review');
const NODE_BIN = process.execPath;

let settings = {};
if (fs.existsSync(SETTINGS)) {
  settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '');
  fs.copyFileSync(SETTINGS, `${SETTINGS}.bak.${stamp}`);
  console.log('backed up settings.json');
}
settings.hooks = settings.hooks || {};

function addHook(event, matcher, command) {
  settings.hooks[event] = settings.hooks[event] || [];
  const exists = settings.hooks[event].some((entry) => (entry.hooks || []).some((h) => h.command === command));
  if (exists) return;
  const entry = matcher
    ? { matcher, hooks: [{ type: 'command', command }] }
    : { hooks: [{ type: 'command', command }] };
  settings.hooks[event].push(entry);
}

const cmd = (file) => `"${NODE_BIN}" "${path.join(SR_HOOKS, file)}"`;
addHook('SessionStart', 'startup|resume|clear|compact', cmd('charter-inject.js'));
addHook('UserPromptSubmit', '', cmd('stack-switch-inject.js'));
addHook('UserPromptSubmit', '', cmd('drift-watch.js'));
addHook('PreToolUse', 'Bash', cmd('guard.js'));
addHook('PostToolUseFailure', '', cmd('mistake-ledger.js'));
addHook('PostToolUse', 'Write|Edit', cmd('mistake-ledger.js'));
addHook('PostToolUse', 'Write|Edit', cmd('scan-on-write.js'));

fs.mkdirSync(CLAUDE_DIR, { recursive: true });
fs.writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
console.log('hooks merged into settings.json (existing entries from other tools untouched)');

// --- 5. Reference-file size guard (zero-token, run occasionally) ----------
console.log('');
console.log('== reference file sizes ==');
const refDir = path.join(HERE, 'references');
for (const f of fs.readdirSync(refDir).filter((n) => n.endsWith('.md')).sort()) {
  const lines = fs.readFileSync(path.join(refDir, f), 'utf8').split('\n').length;
  const flag = lines > 150 ? 'OVER threshold' : 'ok';
  console.log(`  ${f}: ${lines} lines — ${flag}`);
}

// --- 6. Scanner availability report ---------------------------------------
console.log('');
console.log('== scanner availability ==');
function commandExists(name) {
  try {
    if (process.platform === 'win32') {
      execSync(`where ${name}`, { stdio: 'ignore' });
    } else {
      execSync(`command -v ${name}`, { stdio: 'ignore', shell: '/bin/sh' });
    }
    return true;
  } catch {
    return false;
  }
}
const scanners = ['terraform', 'tflint', 'checkov', 'trivy', 'helm', 'kubeconform', 'kube-score', 'kube-linter', 'polaris', 'conftest', 'opa', 'kustomize', 'infracost', 'yamllint', 'gitleaks'];
for (const t of scanners) {
  console.log(commandExists(t) ? `  OK    ${t}` : `  MISS  ${t}  (install separately)`);
}

console.log('');
console.log('== install complete ==');
console.log(`Verify: node -e "console.log(require('${SETTINGS}').hooks)"`);
