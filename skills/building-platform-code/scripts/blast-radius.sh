#!/usr/bin/env bash
# The single highest-value script in this whole system.
# Runs terraform plan, parses the JSON, surfaces every delete/replace action
# in plain language. This is the oracle for the #1 platform-eng failure mode:
# silent destroy/replace on a resource nobody meant to touch.
#
# Usage: blast-radius.sh [dir]   (default: .)
# Requires: terraform, jq
set -uo pipefail
DIR="${1:-.}"
cd "$DIR" || { echo "cannot cd to $DIR — refusing to silently analyze the wrong directory" >&2; exit 1; }

if ! command -v terraform >/dev/null 2>&1; then
  echo "terraform not installed — cannot compute blast radius" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq not installed — cannot parse plan JSON" >&2
  exit 1
fi

PLAN=$(mktemp)
PLAN_ERR=$(mktemp)
trap 'rm -f "$PLAN" "$PLAN.json" "$PLAN_ERR"' EXIT

echo "Running terraform plan..." >&2
if ! terraform plan -out="$PLAN" -input=false 2>&1; then
  echo "terraform plan failed — fix that before assessing blast radius" >&2
  exit 1
fi

if ! terraform show -json "$PLAN" > "$PLAN.json" 2>"$PLAN_ERR"; then
  echo "terraform show -json failed to parse the saved plan — cannot compute blast radius, treating as unsafe" >&2
  cat "$PLAN_ERR" >&2
  exit 1
fi

DESTROYS=$(jq -r '
  .resource_changes[]
  | select(.mode == "managed")
  | select(.change.actions | index("delete"))
  | select(.change.actions | index("create") | not)
  | "  DELETE  \(.address)"
' "$PLAN.json")

REPLACES=$(jq -r '
  .resource_changes[]
  | select(.mode == "managed")
  | select(.change.actions == ["delete","create"] or .change.actions == ["create","delete"])
  | "  REPLACE \(.address)  (reason: \(.action_reason // "unknown"))"
' "$PLAN.json")

CREATES_ONLY=$(jq -r '
  [.resource_changes[] | select(.change.actions == ["create"])] | length
' "$PLAN.json")

UPDATES_ONLY=$(jq -r '
  [.resource_changes[] | select(.change.actions == ["update"])] | length
' "$PLAN.json")

echo ""
echo "=== BLAST RADIUS ==="
if [ -z "$DESTROYS" ] && [ -z "$REPLACES" ]; then
  echo "No deletes or replaces. $CREATES_ONLY create-only, $UPDATES_ONLY in-place update."
  echo "Safe on this axis — still confirm the updates themselves are intended."
else
  [ -n "$DESTROYS" ] && { echo "PURE DELETES (no replacement resource):"; echo "$DESTROYS"; }
  [ -n "$REPLACES" ] && { echo "REPLACES (destroy then recreate — data loss risk on stateful resources):"; echo "$REPLACES"; }
  echo ""
  echo "STOP. Confirm every line above is intended before applying."
  exit 2
fi
