#!/usr/bin/env bash
# Pinned Terraform scan. Degrades gracefully per-tool if not installed.
# Usage: scan-terraform.sh [dir]   (default: .)
set -uo pipefail
DIR="${1:-.}"
cd "$DIR" || { echo "cannot cd to $DIR — refusing to silently scan the wrong directory" >&2; exit 1; }

status=0
run() {
  local name="$1"; shift
  if command -v "$1" >/dev/null 2>&1; then
    echo "--- $name ---"
    "$@" || status=1
  else
    echo "--- $name SKIPPED (not installed) ---"
  fi
}

run "terraform fmt" terraform fmt -check -recursive
run "terraform validate" terraform validate
run "tflint" tflint --recursive
run "checkov" checkov -d . --framework terraform --compact --quiet
run "trivy config" trivy config . --severity HIGH,CRITICAL --exit-code 1

exit $status
