#!/usr/bin/env bash
# Posts a user-selected set of findings to a GitHub PR as ONE batched review
# (inline comments anchored to file:line, plus a summary body) via the REST
# Reviews API — gh pr review has no inline-comment flags, only a single body,
# so this is the one place a raw `gh api` call is the correct tool, not a
# workaround. jq builds the JSON payload — never manual string concatenation
# around finding text, which can contain quotes/backticks/newlines.
#
# Usage:
#   post-review-comments.sh [--dry-run] --pr <number> [--repo owner/name] --summary "<text>" < findings.json
#
# findings.json on stdin: a JSON array of {"path": "...", "line": N, "body": "..."}
# --dry-run: print the exact payload that would be POSTed, make no network call.
set -uo pipefail

DRY_RUN=0
PR=""
REPO=""
SUMMARY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --pr) PR="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --summary) SUMMARY="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$PR" ]; then
  echo "usage: post-review-comments.sh [--dry-run] --pr <number> [--repo owner/name] --summary \"<text>\" < findings.json" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not installed — cannot post PR comments" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq not installed — required to build the review payload safely" >&2
  exit 1
fi

FINDINGS_JSON="$(cat)"
if ! echo "$FINDINGS_JSON" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
  echo "stdin must be a non-empty JSON array of {path, line, body} — got:" >&2
  echo "$FINDINGS_JSON" >&2
  exit 1
fi

REPO_ARGS=()
[ -n "$REPO" ] && REPO_ARGS=(--repo "$REPO")

# The commit the review anchors to — must be the PR's current head, or
# GitHub silently fails to attach comments to lines on a diff that no
# longer matches. Resolved fresh every run, never cached.
#
# "${REPO_ARGS[@]+"${REPO_ARGS[@]}"}" not "${REPO_ARGS[@]}": macOS ships
# bash 3.2 (GPLv3 licensing, Apple hasn't updated it) as the default
# `bash` on PATH, and 3.2's `set -u` throws "unbound variable" expanding
# an EMPTY array — reproduced. This idiom is the portable fix; it works
# identically on 3.2 and on a newer bash.
# Checked by exit code + SHA-shape, not by string-matching gh's error text
# for the word "error" — reproduced that a bad PR number's actual message
# ("Could not resolve to a PullRequest...") doesn't contain that word, so
# the old check missed it and let a garbage commit_id flow straight into
# the POST payload.
if ! COMMIT_SHA="$(gh pr view "$PR" "${REPO_ARGS[@]+"${REPO_ARGS[@]}"}" --json headRefOid -q .headRefOid 2>&1)" \
    || ! [[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "could not resolve PR #$PR's head commit — is the PR number/repo correct?" >&2
  echo "$COMMIT_SHA" >&2
  exit 1
fi

RESOLVED_REPO="$REPO"
if [ -z "$RESOLVED_REPO" ]; then
  RESOLVED_REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>&1)"
fi

# --- Line-resolvability preflight -----------------------------------------
# GitHub rejects the ENTIRE review with 422 "Line could not be resolved" if
# any single comment's line is not part of the PR diff on the right side.
# path-in-diff is not enough: a line on an unchanged CONTEXT line that sits
# OUTSIDE every hunk (e.g. line 27 of a modified file whose only hunk covers
# lines 12-18) is rejected. Reproduced on platform-gitops#75. So validate
# here — in BOTH dry-run and real mode — that every finding's line falls on a
# right-side line the diff actually contains (an added `+` line, or a context
# ` ` line shown within a hunk; both are commentable on side:RIGHT). Fail with
# the offending anchors + the nearest valid lines, instead of a 422 that costs
# a full re-post. For a newly-ADDED file the whole file is one hunk, so every
# line qualifies — this only ever bites modified files.
DIFF="$(gh pr diff "$PR" "${REPO_ARGS[@]+"${REPO_ARGS[@]}"}" 2>/dev/null || true)"
if [ -z "$DIFF" ]; then
  echo "warning: could not fetch PR diff for line-resolvability preflight — skipping it (the real POST will still reject an unresolvable line)." >&2
else
  POSTABLE="$(mktemp)"
  # Emit "path<TAB>line" for every right-side line the diff contains.
  # BSD-awk-safe: no 3-arg match(); parse the +N from the @@ header by hand.
  printf '%s\n' "$DIFF" | awk '
    /^\+\+\+ /   { p=$2; sub(/^b\//,"",p); next }   # file header (starts with +++, handle before generic +)
    /^--- /      { next }
    /^diff --git/{ next }
    /^@@/ {
      plus=""
      for (i=1;i<=NF;i++) { if (substr($i,1,1)=="+") { plus=$i; break } }
      sub(/^\+/,"",plus); sub(/,.*/,"",plus); ln=plus+0; next
    }
    {
      c=substr($0,1,1)
      if (c=="+")      { print p "\t" ln; ln++ }   # added line: right-side, commentable
      else if (c==" ") { print p "\t" ln; ln++ }   # context line within a hunk: also right-side
      # "-" (removed) and metadata lines do not advance the right-side counter
    }
  ' > "$POSTABLE"

  BAD=""
  while IFS="$(printf '\t')" read -r fpath fline; do
    [ -n "$fpath" ] || continue
    if ! grep -qxF "$(printf '%s\t%s' "$fpath" "$fline")" "$POSTABLE"; then
      near="$(grep -F "$(printf '%s\t' "$fpath")" "$POSTABLE" | cut -f2 \
              | awk -v w="$fline" '{d=$1-w; if(d<0)d=-d; print d"\t"$1}' \
              | sort -n | head -6 | cut -f2 | sort -n | tr '\n' ' ')"
      [ -z "$near" ] && near="(no right-side lines in this file — is it in the diff at all?)"
      BAD="$BAD
  $fpath:$fline  → not a diff line on the right side. Nearest valid lines: $near"
    fi
  done <<EOF
$(echo "$FINDINGS_JSON" | jq -r '.[] | "\(.path)\t\(.line)"')
EOF

  rm -f "$POSTABLE"
  if [ -n "$BAD" ]; then
    echo "line-resolvability preflight FAILED — GitHub would reject the whole review (422). Re-anchor these to a line the diff actually changed/shows:$BAD" >&2
    exit 1
  fi
fi
# --- end preflight ---------------------------------------------------------

# side: RIGHT anchors to the new (post-change) file version — correct for
# findings about code as it exists in this diff, which is every finding
# this system produces. A finding about a deleted line would need side:
# LEFT, but singularity-review's findings are always about current
# code, not removed code, so RIGHT is the only case this needs to handle.
PAYLOAD="$(echo "$FINDINGS_JSON" | jq --arg commit "$COMMIT_SHA" --arg summary "$SUMMARY" '
  {
    commit_id: $commit,
    event: "COMMENT",
    body: $summary,
    comments: [ .[] | {path: .path, line: .line, side: "RIGHT", body: .body} ]
  }
')"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "=== DRY RUN — payload that would be posted to PR #$PR ($RESOLVED_REPO) ==="
  echo "$PAYLOAD" | jq .
  exit 0
fi

echo "Posting $(echo "$FINDINGS_JSON" | jq 'length') inline comment(s) to PR #$PR ($RESOLVED_REPO)..." >&2
if ! RESULT="$(echo "$PAYLOAD" | gh api "repos/$RESOLVED_REPO/pulls/$PR/reviews" -X POST --input - 2>&1)"; then
  echo "POST failed:" >&2
  echo "$RESULT" >&2
  exit 1
fi

echo "$RESULT" | jq -r '"Posted: " + .html_url'
