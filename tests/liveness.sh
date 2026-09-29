#!/usr/bin/env bash
# Liveness check for tests/guard.test.js: proves the suite would actually
# fail if evaluateCommand were silently gutted, not just that it currently
# passes. A test suite with 100% pass and zero mutation coverage looks
# identical from the outside to one that isn't wired to anything real.
#
# Mechanism: copy guard.js, append an override that replaces its exported
# evaluateCommand with a no-op that always allows everything, then run the
# real test file against that stub via GUARD_MODULE. The stub must make
# every should-deny/should-ask case in the suite fail -- if the suite still
# reports all-green against a gutted implementation, the suite itself is
# the thing that's broken.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/hooks/singularity-review"
REAL_GUARD="$HOOKS_DIR/guard.js"
# Must live next to lib.js, not in an arbitrary tmp dir -- guard.js does
# `require('./lib')` internally, resolved relative to its own file location.
# An earlier version of this script copied the stub to $TMPDIR and every run
# "passed" liveness for the wrong reason: the stub crashed on a module-not-
# found error before any test case ran, and a crash-nonzero-exit looked
# identical to a real deny-case-went-red nonzero exit. Real gap, caught by
# actually reading what "LIVENESS OK" was verifying, not just trusting the
# exit code.
STUB="$HOOKS_DIR/guard.liveness-stub.$$.js"
trap 'rm -f "$STUB"' EXIT

cp "$REAL_GUARD" "$STUB"
# Reassigning a property on the already-exported object is valid JS and
# doesn't touch anything else guard.js exports (DENY_RULES, tokenize, etc.)
# -- only evaluateCommand itself is gutted.
cat >> "$STUB" <<'JS'

// --- LIVENESS STUB: every deny/ask case must fail against this ---
module.exports.evaluateCommand = () => ({ decision: null });
JS

OUT="$HOOKS_DIR/liveness-output.$$.tmp"
echo "== liveness: running guard.test.js against a gutted evaluateCommand =="
set +e
GUARD_MODULE="$STUB" node "$HERE/guard.test.js" > "$OUT" 2>&1
set -e
cat "$OUT"

# A nonzero exit alone doesn't prove the deny/ask cases went red -- a crash
# in the stub (a bad require path, a syntax error from the appended override)
# also exits nonzero, and would make this check "pass" for the wrong reason
# (this exact failure mode happened once already: see the comment above about
# the earlier tmp-dir version). Require the suite's own summary line to show
# real failures, not just any nonzero exit.
SUMMARY_LINE=$(grep -E '^[0-9]+ passed, [0-9]+ failed' "$OUT" || true)
FAILED_COUNT=$(echo "$SUMMARY_LINE" | grep -oE '[0-9]+ failed' | grep -oE '^[0-9]+' || echo "0")
rm -f "$OUT"

if [ -z "$SUMMARY_LINE" ]; then
  echo ""
  echo "LIVENESS INCONCLUSIVE: guard.test.js didn't print its normal summary line at all"
  echo "(the stub likely crashed before running any case -- check the output above)."
  echo "This is NOT proof the deny/ask cases would catch a gutted evaluateCommand(); it's proof"
  echo "the stub itself is broken. Fix the stub, don't treat this exit code as a pass."
  exit 1
fi

if [ "$FAILED_COUNT" -eq 0 ]; then
  echo ""
  echo "LIVENESS FAILED: the suite reported all-passing ($SUMMARY_LINE) against a gutted"
  echo "evaluateCommand(). That means the deny/ask cases in guard.test.js are not actually"
  echo "exercising real logic -- a passing 'node tests/guard.test.js' run would not have"
  echo "caught evaluateCommand being silently replaced with a no-op. Fix the suite."
  exit 1
fi

echo ""
echo "LIVENESS OK: $FAILED_COUNT case(s) correctly went red against a gutted evaluateCommand()."
echo "The deny/ask cases are wired to real logic, not passing by construction."
