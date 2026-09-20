#!/usr/bin/env bash
# Idempotent installer for Singularity Review.
# Symlinks skills/agents/hooks from this vault into ~/.claude, then merges
# (never overwrites) the hooks block in ~/.claude/settings.json via jq.
# Safe to re-run — every step checks current state before acting.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS="$CLAUDE_DIR/settings.json"

echo "== Singularity Review install =="
echo "source: $HERE"
echo "target: $CLAUDE_DIR"
echo ""

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required and not found. Install it first (brew install jq)." >&2
  exit 1
fi

# --- 1. Symlink skills ---------------------------------------------------
mkdir -p "$CLAUDE_DIR/skills"
for skill in building-platform-code singularity-review handing-off-context posting-review-comments; do
  target="$CLAUDE_DIR/skills/$skill"
  src="$HERE/skills/$skill"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$src" ]; then
    echo "skill  $skill  already linked"
  elif [ -e "$target" ]; then
    echo "skill  $skill  SKIPPED — $target exists and is not our symlink, resolve manually"
  else
    ln -s "$src" "$target"
    echo "skill  $skill  linked"
  fi
done

# --- 2. Symlink agents ----------------------------------------------------
if [ -L "$CLAUDE_DIR/agents" ] && [ "$(readlink "$CLAUDE_DIR/agents")" = "$HERE/agents" ]; then
  echo "agents  already linked"
elif [ -e "$CLAUDE_DIR/agents" ]; then
  echo "agents  SKIPPED — $CLAUDE_DIR/agents exists and is not our symlink, resolve manually"
else
  ln -s "$HERE/agents" "$CLAUDE_DIR/agents"
  echo "agents  linked"
fi

# --- 3. Symlink hooks/singularity-review -------------------------------------------------
mkdir -p "$CLAUDE_DIR/hooks"
if [ -L "$CLAUDE_DIR/hooks/singularity-review" ] && [ "$(readlink "$CLAUDE_DIR/hooks/singularity-review")" = "$HERE/hooks/singularity-review" ]; then
  echo "hooks/singularity-review  already linked"
elif [ -e "$CLAUDE_DIR/hooks/singularity-review" ]; then
  echo "hooks/singularity-review  SKIPPED — exists and is not our symlink, resolve manually"
else
  ln -s "$HERE/hooks/singularity-review" "$CLAUDE_DIR/hooks/singularity-review"
  echo "hooks/singularity-review  linked"
fi

mkdir -p "$CLAUDE_DIR/state" "$CLAUDE_DIR/handoffs"

# Prune state files from sessions older than 30 days — nothing else does this.
# ponytail: mtime-based prune on install/re-run, not a cron/daemon. Fine as
# long as install.sh gets re-run occasionally; add a real TTL job if state/
# grows large between installs.
pruned=$(find "$CLAUDE_DIR/state" -maxdepth 1 -name 'sr-*' -mtime +30 -print -delete 2>/dev/null | wc -l | tr -d ' ')
[ "$pruned" -gt 0 ] && echo "pruned $pruned stale state file(s) older than 30 days"

# --- 4. Merge hooks into settings.json (additive, idempotent) -------------
NODE_BIN="$(command -v node || echo node)"
SR_HOOKS="$CLAUDE_DIR/hooks/singularity-review"

# Fresh-machine guard: settings.json may not exist yet. Without this, the
# `cp` below aborts the whole install under `set -euo pipefail` AFTER the
# symlinks are already made — the opposite of "idempotent, safe to re-run".
[ -f "$SETTINGS" ] || printf '{}\n' > "$SETTINGS"

cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
echo "backed up settings.json"

add_hook() {
  # $1 = event name, $2 = matcher or "", $3 = command, $4 = jq filter description (unused, for readability)
  local event="$1" matcher="$2" command="$3"
  local tmp
  tmp="$(mktemp)"
  jq --arg event "$event" --arg matcher "$matcher" --arg command "$command" '
    .hooks[$event] //= [] |
    (.hooks[$event] | any(.hooks[]?.command == $command)) as $exists |
    if $exists then .
    else
      .hooks[$event] += [
        if $matcher == "" then { hooks: [ { type: "command", command: $command } ] }
        else { matcher: $matcher, hooks: [ { type: "command", command: $command } ] }
        end
      ]
    end
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
}

add_hook "SessionStart" "startup|resume|clear|compact" "\"$NODE_BIN\" \"$SR_HOOKS/charter-inject.js\""
add_hook "UserPromptSubmit" "" "\"$NODE_BIN\" \"$SR_HOOKS/stack-switch-inject.js\""
add_hook "UserPromptSubmit" "" "\"$NODE_BIN\" \"$SR_HOOKS/drift-watch.js\""
add_hook "PreToolUse" "Bash" "\"$NODE_BIN\" \"$SR_HOOKS/guard.js\""
add_hook "PostToolUseFailure" "" "\"$NODE_BIN\" \"$SR_HOOKS/mistake-ledger.js\""
add_hook "PostToolUse" "Write|Edit" "\"$NODE_BIN\" \"$SR_HOOKS/mistake-ledger.js\""
add_hook "PostToolUse" "Write|Edit" "\"$NODE_BIN\" \"$SR_HOOKS/scan-on-write.js\""

echo "hooks merged into settings.json (existing caveman/claude-mem/ponytail/rtk entries untouched)"

# --- 5. Reference-file size guard (zero-token, run occasionally) ----------
echo ""
echo "== reference file sizes =="
for f in "$HERE"/references/*.md; do
  lines=$(wc -l < "$f" | tr -d ' ')
  name=$(basename "$f")
  if [ "$lines" -gt 150 ]; then
    echo "  $name: $lines lines — OVER threshold, run: /caveman-compress $f"
  else
    echo "  $name: $lines lines — ok"
  fi
done

# --- 6. Scanner availability report ---------------------------------------
echo ""
echo "== scanner availability =="
for t in terraform tflint checkov trivy helm kubeconform kube-score kube-linter polaris conftest opa kustomize infracost yamllint gitleaks; do
  if command -v "$t" >/dev/null 2>&1; then echo "  OK    $t"; else echo "  MISS  $t  (install: brew install $t)"; fi
done

echo ""
echo "== install complete =="
echo "Verify: jq '.hooks' \"$SETTINGS\" | less"
