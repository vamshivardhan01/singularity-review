#!/usr/bin/env bash
# Pinned Helm/K8s scan. Degrades gracefully per-tool if not installed.
# Usage: scan-helm.sh <chart-dir>
set -uo pipefail
CHART="${1:?usage: scan-helm.sh <chart-dir>}"

status=0
run() { local name="$1"; shift; echo "--- $name ---"; "$@" || status=1; }
skip() { echo "--- $1 SKIPPED (not installed) ---"; }

if command -v helm >/dev/null 2>&1; then
  run "helm lint" helm lint "$CHART"
else
  skip "helm lint"
fi

RENDERED=$(mktemp)
trap 'rm -f "$RENDERED"' EXIT
if command -v helm >/dev/null 2>&1; then
  helm template "$CHART" > "$RENDERED" 2>&1 || { echo "helm template FAILED"; cat "$RENDERED"; rm -f "$RENDERED"; exit 1; }
else
  echo "helm not installed — cannot render, skipping all render-dependent checks"; exit 1
fi

if command -v kubeconform >/dev/null 2>&1; then
  echo "--- kubeconform ---"
  kubeconform -strict -summary -ignore-missing-schemas < "$RENDERED" || status=1
else skip "kubeconform"; fi

if command -v kube-score >/dev/null 2>&1; then
  echo "--- kube-score ---"
  kube-score score "$RENDERED" || status=1
else skip "kube-score"; fi

if command -v kube-linter >/dev/null 2>&1; then
  echo "--- kube-linter ---"
  kube-linter lint "$RENDERED" || status=1
else skip "kube-linter"; fi

if command -v trivy >/dev/null 2>&1; then
  echo "--- trivy config ---"
  trivy config "$CHART" --severity HIGH,CRITICAL --exit-code 1 || status=1
else skip "trivy"; fi

rm -f "$RENDERED"
exit $status
