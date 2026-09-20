#!/usr/bin/env bash
# Pinned GitOps/Kustomize scan. Degrades gracefully per-tool if not installed.
# Usage: scan-gitops.sh <path>
set -uo pipefail
TARGET="${1:?usage: scan-gitops.sh <path>}"

status=0
skip() { echo "--- $1 SKIPPED (not installed) ---"; }

if [ -f "$TARGET/kustomization.yaml" ] || [ -f "$TARGET/kustomization.yml" ]; then
  if command -v kustomize >/dev/null 2>&1; then
    echo "--- kustomize build + kubeconform ---"
    if command -v kubeconform >/dev/null 2>&1; then
      kustomize build "$TARGET" | kubeconform -strict -ignore-missing-schemas || status=1
    else
      kustomize build "$TARGET" > /dev/null || status=1
      skip "kubeconform"
    fi
  else skip "kustomize"; fi
else
  echo "--- yamllint (no kustomization.yaml found, plain manifests) ---"
  if command -v yamllint >/dev/null 2>&1; then
    yamllint "$TARGET" || status=1
  else skip "yamllint"; fi
fi

echo "--- ArgoCD prune/allowEmpty flag scan (grep, zero-token oracle) ---"
if grep -rn "allowEmpty: *true" "$TARGET" --include='*.yaml' 2>/dev/null; then
  echo "^^ allowEmpty:true found — confirm this is deliberate before merging"
  status=1
fi
# Process substitution, not a pipe, so the while loop runs in THIS shell —
# a pipe (`grep ... | while read`) would run the loop in a subshell, and
# any `status=1` set inside it would be lost the moment the subshell exits,
# silently keeping the script's exit code 0 even when prune:true is flagged.
while read -r f; do
  echo "prune:true in $f — run: argocd app diff <app> --local $TARGET before merging"
  status=1
done < <(grep -rln "prune: *true" "$TARGET" --include='*.yaml' 2>/dev/null)

echo "--- argocd app diff (only if argocd CLI + context available) ---"
if command -v argocd >/dev/null 2>&1; then
  echo "argocd installed — run 'argocd app diff <app-name> --local $TARGET' manually with the correct app name"
else
  skip "argocd CLI"
fi

exit $status
