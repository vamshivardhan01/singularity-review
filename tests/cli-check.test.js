#!/usr/bin/env node
// Regression table for bin/cli.js's `check` subcommand argv parsing --
// separate from guard.test.js, which only tests evaluateCommand() directly
// and never exercises this layer at all. That gap is exactly where a real
// bug lived: `check --cwd /tmp "cmd"` (flags before the positional, a normal
// CLI habit) silently evaluated the literal string "--cwd" as the command
// and dropped the real one, reporting a false ALLOW.
//
// Spawns the real CLI as a subprocess (not a require()) since the thing
// under test IS process.argv parsing -- faking argv in-process wouldn't
// exercise the actual entrypoint.

const { spawnSync } = require('child_process');
const path = require('path');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function runCheck(args) {
  const r = spawnSync('node', [CLI, 'check', ...args], { encoding: 'utf8' });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status };
}

// [args, expectedExitCode, expectedCommandLine or null, description]
const CASES = [
  [['terraform destroy'], 1, 'command:  terraform destroy', 'bare deny case, no flags'],
  [['terraform plan'], 0, 'command:  terraform plan', 'bare allow case, no flags'],
  [['echo hello', '--cwd', '/tmp'], 0, 'command:  echo hello', '--cwd AFTER the command (already worked before the fix)'],
  [['--cwd', '/tmp', 'echo hello'], 0, 'command:  echo hello', '--cwd BEFORE the command -- the exact bug: used to report "command: --cwd" and silently drop the real command'],
  [[], 2, null, 'no arguments at all -- usage error'],
  [['echo hello', '--cwd'], 2, null, '--cwd with nothing after it -- usage error, not a crash or a silent undefined cwd'],
  [['a', 'b'], 2, null, 'two positional arguments -- ambiguous, usage error rather than silently picking the first'],
];

let pass = 0, fail = 0;
for (const [args, expectedExit, expectedLine, desc] of CASES) {
  const { stdout, exitCode } = runCheck(args);
  const exitOk = exitCode === expectedExit;
  const lineOk = expectedLine === null || stdout.includes(expectedLine);
  if (exitOk && lineOk) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${desc}\n  args:     ${JSON.stringify(args)}\n  expected: exit ${expectedExit}${expectedLine ? `, stdout containing "${expectedLine}"` : ''}\n  got:      exit ${exitCode}, stdout: ${JSON.stringify(stdout)}`);
  }
}

console.log(`${pass} passed, ${fail} failed (${pass + fail} total)`);
if (fail > 0) process.exit(1);
