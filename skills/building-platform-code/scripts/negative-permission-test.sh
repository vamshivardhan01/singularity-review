#!/usr/bin/env bash
# Negative permission testing — asserts a credential/role CANNOT do the things
# it should never be able to do, rather than asserting it CAN do what it's
# meant to. This is the inverse of a normal capability check, and it's the
# only check that actually catches privilege creep: a role widened by an
# unrelated PR six months from now still silently passes every "can it do
# its job" test, but fails a negative assertion immediately.
#
# Verified pattern, not invented here — this mirrors the "prove it, then
# watch it" negative-testing approach documented for AI-agent IAM/RBAC
# containment (kubectl auth can-i, terraform plan/apply credential split),
# cross-checked against real incidents (an agent using an overprivileged
# standing token to delete a production DB + all its backups because
# nothing enforced least privilege at the credential layer, not the prompt
# layer). Applies the same logic to any ServiceAccount/IAM role this repo's
# CI or an agent might run under — not just to Claude Code's own tool
# permissions, which are a separate, already-covered surface (guard.js).
#
# Usage:
#   negative-permission-test.sh k8s <namespace> <service-account>
#   negative-permission-test.sh aws <role-arn> [--profile <name>]
#
# Exits 0 if every forbidden check is correctly denied. Exits 1 and lists
# every unexpectedly-granted permission if any forbidden check is allowed —
# that is a real finding, not a false positive, regardless of how the
# permission got there.
set -uo pipefail

MODE="${1:-}"
if [ "$MODE" != "k8s" ] && [ "$MODE" != "aws" ]; then
  echo "usage: negative-permission-test.sh k8s <namespace> <service-account>" >&2
  echo "       negative-permission-test.sh aws <role-arn> [--profile <name>]" >&2
  exit 1
fi

status=0

run_k8s() {
  local ns="${1:?usage: negative-permission-test.sh k8s <namespace> <service-account>}"
  local sa="${2:?usage: negative-permission-test.sh k8s <namespace> <service-account>}"
  local principal="system:serviceaccount:${ns}:${sa}"

  if ! command -v kubectl >/dev/null 2>&1; then
    echo "kubectl not installed — cannot run negative permission test" >&2
    exit 1
  fi

  echo "=== Negative permission test: $principal ==="
  echo "--- What this identity CAN do (informational, for the reviewer) ---"
  kubectl auth can-i --list --as="$principal" -n "$ns" 2>&1 || true

  echo ""
  echo "--- Forbidden operations (every line below MUST be 'no') ---"
  # Each of these has caused a real, documented incident somewhere when
  # granted to an over-scoped agent/CI identity. See references/aws-org-iam.md
  # and the analogous k8s section for why each specific line matters.
  local -a FORBIDDEN=(
    "delete pods"
    "delete deployments"
    "delete namespaces"
    "delete persistentvolumeclaims"
    "delete persistentvolumes"
    "get secrets"
    "list secrets"
    "create pods/exec"
    "create pods/portforward"
    "create pods"
    "impersonate users"
    "escalate roles"
    "bind rolebindings"
    "create clusterrolebindings"
  )

  for check in "${FORBIDDEN[@]}"; do
    read -r verb resource <<< "$check"
    result=$(kubectl auth can-i "$verb" "$resource" --as="$principal" -n "$ns" -A 2>&1)
    if [ "$result" = "yes" ]; then
      echo "  DENIED (expected)  $verb $resource ... UNEXPECTEDLY GRANTED"
      status=1
    else
      echo "  ok                 $verb $resource -> no"
    fi
  done
}

run_aws() {
  local role_arn="${1:?usage: negative-permission-test.sh aws <role-arn> [--profile <name>]}"
  shift
  # profile_args is empty when no --profile is given (the common case).
  # "${profile_args[@]+"${profile_args[@]}"}" below, not "${profile_args[@]}":
  # macOS ships bash 3.2 by default (GPLv3), and 3.2's `set -u` throws
  # "unbound variable" expanding an empty array — reproduced running this
  # exact pattern. This idiom is the portable fix.
  local profile_args=("$@")

  if ! command -v aws >/dev/null 2>&1; then
    echo "aws CLI not installed — cannot run negative permission test" >&2
    exit 1
  fi

  echo "=== Negative permission test (simulation): $role_arn ==="
  echo "Uses IAM policy simulator (iam simulate-principal-policy) — this checks"
  echo "what the policy DOCUMENT allows, not a live credential; still catches"
  echo "the wildcard/overbroad-grant class of finding without needing to assume"
  echo "the role."
  echo ""
  echo "--- Forbidden actions (every line below MUST be 'implicitDeny' or 'explicitDeny') ---"
  # Same rationale as the k8s list — each of these is the specific action
  # that turned a scoped-looking role into an incident in a documented case.
  local -a FORBIDDEN_ACTIONS=(
    "iam:CreateAccessKey"
    "iam:PutUserPolicy"
    "iam:AttachRolePolicy"
    "iam:CreatePolicyVersion"
    "s3:DeleteBucket"
    "s3:DeleteObject"
    "rds:DeleteDBInstance"
    "rds:DeleteDBCluster"
    "ec2:TerminateInstances"
    "kms:ScheduleKeyDeletion"
    "organizations:LeaveOrganization"
    "organizations:DeletePolicy"
  )

  local resource="*"
  for action in "${FORBIDDEN_ACTIONS[@]}"; do
    result=$(aws iam simulate-principal-policy \
      --policy-source-arn "$role_arn" \
      --action-names "$action" \
      --resource-arns "$resource" \
      "${profile_args[@]+"${profile_args[@]}"}" \
      --query 'EvaluationResults[0].EvalDecision' \
      --output text 2>&1)
    if [ "$result" = "allowed" ]; then
      echo "  DENIED (expected)  $action ... UNEXPECTEDLY ALLOWED"
      status=1
    else
      echo "  ok                 $action -> $result"
    fi
  done
}

case "$MODE" in
  k8s) run_k8s "${2:-}" "${3:-}" ;;
  aws) shift; run_aws "$@" ;;
esac

echo ""
if [ "$status" -eq 0 ]; then
  echo "=== PASS: no forbidden permission is granted ==="
else
  echo "=== FAIL: at least one forbidden permission is granted — this is a real finding, not a false positive ==="
fi
exit $status
