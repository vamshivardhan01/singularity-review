#!/usr/bin/env bash
# Detects which infra stack a directory belongs to, by file presence.
# Outputs exactly one of: terraform | helm | gitops | aws-iam | none
# Used so skills load only the ONE relevant reference file, never all of them.
#
# Generic by design — no hardcoded repo names, works in any org's repo.
# Mirrors hooks/singularity-review/lib.js's detectStack() logic exactly:
#   1. Never treat $HOME itself as a project.
#   2. Require a git root (walk up looking for .git) before scanning at all —
#      this is what stops a random non-project directory (a /tmp scratch
#      dir, Desktop, Downloads) from false-positiving on a stray file.
#   3. Walk upward from the target to the git root, checking markers at each
#      level (handles e.g. an SCP subdirectory whose own .tf lives at the
#      repo root, not locally).
#   4. If nothing found on that path, bounded-depth scan downward FROM THE
#      GIT ROOT (not from the target), so markers in an unrelated subtree
#      (charts/<name>/, accounts/<name>/) still get found.
set -uo pipefail

DIR="${1:-.}"
DIR="$(cd "$DIR" 2>/dev/null && pwd -P || echo "$DIR")"
HOME_REAL="$(cd "$HOME" 2>/dev/null && pwd -P || echo "$HOME")"

if [ "$DIR" = "$HOME_REAL" ]; then
  echo "none"; exit 0
fi

find_git_root() {
  local cur="$1" up=0
  while [ "$up" -le 8 ]; do
    [ -e "$cur/.git" ] && { echo "$cur"; return 0; }
    local parent
    parent="$(dirname "$cur")"
    [ "$parent" = "$cur" ] && return 1
    cur="$parent"
    up=$((up + 1))
  done
  return 1
}

markers_at() {
  local d="$1"
  if find "$d" -maxdepth 1 -name '*.tf' -print -quit 2>/dev/null | grep -q .; then
    iam_marker "$d" "terraform"
    return 0
  fi
  if [ -f "$d/Chart.yaml" ]; then echo "helm"; return 0; fi
  if [ -f "$d/kustomization.yaml" ] || [ -f "$d/kustomization.yml" ]; then echo "gitops"; return 0; fi
  echo "none"
}

# Word-boundary aws-iam check, matching lib.js's /\b(scp|identity-center|iam)\b/i
# exactly — a plain substring/glob match (the previous *[Ii][Aa][Mm]*) also
# fires on "miami", "iambic", or any other path containing "iam" as a
# substring, not just as a distinct path segment/word. Checks each `/`-
# separated path segment against the same three keywords, case-insensitively,
# as whole-segment or hyphen-delimited-word matches.
iam_marker() {
  local d="$1" default_label="$2"
  local seg lower
  IFS='/' read -ra segs <<< "$d"
  for seg in "${segs[@]}"; do
    lower="$(printf '%s' "$seg" | tr '[:upper:]' '[:lower:]')"
    case "$lower" in
      scp|identity-center|iam|*-scp|*-identity-center|*-iam|scp-*|identity-center-*|iam-*) echo "aws-iam"; return 0 ;;
    esac
  done
  echo "$default_label"
}

GIT_ROOT="$(find_git_root "$DIR")" || { echo "none"; exit 0; }

cur="$DIR"
while :; do
  found="$(markers_at "$cur")"
  [ "$found" != "none" ] && { echo "$found"; exit 0; }
  [ "$cur" = "$GIT_ROOT" ] && break
  cur="$(dirname "$cur")"
done

# Bounded downward scan from the repo root, skipping noise dirs, matching
# lib.js's SCAN_SKIP_DIRS set + MAX_DEPTH. Deliberately depth-first
# per-directory (check markers_at() on a directory fully before descending
# into any of its children), matching lib.js's scanDown() exactly — not a
# single combined `find`, which returns whichever marker pattern the
# filesystem walk happens to hit first, independent of directory nesting.
# A repo with more than one marker type in different subtrees (e.g. both
# modules/*.tf and charts/*/Chart.yaml) resolves to whichever subtree is
# visited first — same rule the JS hook uses, so hook-injected pointer and
# skill-loaded reference stay consistent on the same repo state.
scan_down() {
  local d="$1" depth="$2"
  local found
  found="$(markers_at "$d")"
  if [ "$found" != "none" ]; then echo "$found"; return 0; fi
  if [ "$depth" -ge 5 ]; then echo "none"; return 0; fi
  local entry base r
  while IFS= read -r entry; do
    base="$(basename "$entry")"
    case "$base" in
      node_modules|.git|.terraform|vendor|dist|build|.venv|venv|__pycache__|.cache|target|.next|.turbo) continue ;;
      .*) continue ;;
    esac
    r="$(scan_down "$entry" $((depth + 1)))"
    if [ "$r" != "none" ]; then echo "$r"; return 0; fi
  done < <(find "$d" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
  echo "none"
}

scan_down "$GIT_ROOT" 0
