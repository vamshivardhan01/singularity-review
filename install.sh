#!/usr/bin/env bash
# Thin shim so a cloned (non-npm) checkout still has a bash entrypoint.
# The real installer is bin/cli.js — Node stdlib only, no bash/jq dependency.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$HERE/bin/cli.js" "$@"
