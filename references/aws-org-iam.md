---
title: AWS Organizations / IAM failure taxonomy
type: reference
scope: singularity-review
---

# AWS Org / IAM — killer failure modes

Applies to any repo managing AWS Organizations (SCPs, identity center, account structure) or IAM directly.

## SCP misuse

- SCPs are a **guardrail (max permission ceiling), not a grant** — an SCP that allows an action does nothing; IAM still has to grant it. Common mistake: writing an SCP as if it were an IAM policy that grants access.
- An SCP attached at the **root OU with no break-glass path** can lock the entire org out of a service, including out of fixing the SCP itself. Any PR touching a root-level or broadly-scoped SCP is an automatic stop-and-confirm — check for an explicit exception/break-glass principal.

## Cross-account trust (confused deputy)

- Trust policy `Principal: "*"` or a same-account-only `Principal` with no `Condition` — either lets any account (or any caller with the ARN) assume the role.
- Missing `sts:ExternalId` or `aws:PrincipalOrgID` condition on a cross-account trust = the classic confused-deputy setup: a third party who obtains the role ARN can assume it on behalf of an unrelated caller.
- `iam:PassRole` with `Resource: "*"` — lets the grantee pass *any* role in the account to a service, effectively granting whatever that most-privileged role can do.

## Public exposure

- S3 public access requires checking **all four** Block Public Access toggles plus the bucket policy plus any object/bucket ACL — a scanner catching one and missing another still leaves the bucket public.
- Security group ingress `0.0.0.0/0` on 22/3389/database ports (5432, 3306, 27017, 6379, etc.) — the most common real-world breach vector, still worth flagging every time a scanner would miss a non-standard port.
- KMS key policy granting `kms:*` to account root without further restriction — root can then decrypt anything under that key regardless of any other IAM policy.

## Structural

- Missing org-wide CloudTrail or log-file validation disabled — no forensic trail if any of the above go wrong.
- Self-service IAM roles (e.g. workload account CI roles) with no permissions boundary — the boundary is what stops a role from escalating past its intended scope even if its attached policy is later widened by mistake.
- **Positive checks ("can this role do its job") never catch privilege creep — only a negative check does.** A role widened by an unrelated PR to fix an immediate blocker still passes every positive capability test months later; it only fails a check that asserts what it must never be able to do. Run `negative-permission-test.sh aws <role-arn>` (IAM policy simulator against a fixed forbidden-action list: `iam:AttachRolePolicy`, `iam:CreateAccessKey`, `rds:DeleteDBInstance`, `kms:ScheduleKeyDeletion`, etc.) or `negative-permission-test.sh k8s <namespace> <service-account>` (the k8s equivalent via `kubectl auth can-i`) on any diff that touches a role/policy/ServiceAccount/RBAC binding.

## What no scanner catches here

Whether a given cross-account trust relationship matches the org's actual account topology (only knowable from reading the target repo's own architecture/decisions docs, not from the policy JSON alone), whether an SCP exception is scoped to the right principal, whether a wildcard that *is* intentional (e.g. a genuinely account-wide read role) is documented as such.
