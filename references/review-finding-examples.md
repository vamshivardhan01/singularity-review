---
title: Worked finding examples — calibration for FIND and VERIFY agents
type: reference
scope: singularity-review
---

# Worked finding examples

Calibration for what a real finding looks like in this system. Each agent file keeps one inline anchor example; this file holds the rest. **Read this when you are unsure whether what you have clears the bar** — not routinely.

The shared bar, across every role: **exact `file:line`, the actual oracle output pasted verbatim (not paraphrased), and the specific mechanism** — never "might cause issues."

## Contents
- [platform-engineer](#platform-engineer)
- [solutions-architect](#solutions-architect)
- [devops-sre](#devops-sre)
- [backend-engineer](#backend-engineer)
- [adversarial-verifier](#adversarial-verifier)

## platform-engineer

Negative-permission finding — a grant widened as a side effect, caught by checking what is *forbidden* rather than what works:

```
[P1] ServiceAccount widened to grant secrets read as a side effect of a namespace-wide Role change — charts/api/templates/rbac.yaml:8
`negative-permission-test.sh k8s prod api-sa` output:
  DENIED (expected)  get secrets ... UNEXPECTEDLY GRANTED
  DENIED (expected)  list secrets ... UNEXPECTEDLY GRANTED
The diff changed a `resources:` list from `["configmaps"]` to `["configmaps","secrets"]`
on a Role bound to `api-sa`, intended to let the pod read one specific
ConfigMap added in this PR. The actual grant is namespace-wide secrets
read — any credential in the `prod` namespace, including cloud keys stored
as Secrets, is now readable by this ServiceAccount. Scope to the specific
ConfigMap via `resourceNames`, not a broadened `resources:` list.
role: platform-engineer
```

Why it clears the bar: the tool output names the specific unexpected grant, and the finding explains the gap between stated intent (one ConfigMap) and actual scope (every Secret in the namespace).

## solutions-architect

Contract-breakage finding — the consumer trace is the evidence:

```
[P1] Removing `vpc_id` output breaks 3 downstream callers with no deprecation path — modules/network/outputs.tf:22
`output "vpc_id"` was deleted in this diff. Grep across the org's other repos
this session has access to (and this repo) shows three callers still
referencing it:
  environments/prod/main.tf:8    vpc_id = module.network.vpc_id
  environments/staging/main.tf:8 vpc_id = module.network.vpc_id
  modules/eks/variables.tf:14    default = module.network.vpc_id  (indirect)
No `moved` block, no deprecation warning, no major-version bump on the module
source ref. Any consumer running `terraform plan` after pulling this change
gets a hard "Unsupported attribute" error, not a warning — this is a breaking
change shipped as if additive.
role: solutions-architect
```

Why it clears the bar: actual grep output showing each caller by `file:line`, plus the concrete failure a consumer hits. "No callers found" stated explicitly is equally valid evidence.

## devops-sre

Testability finding — distinct from the general "is it deployable" question:

```
[P2] Chart has 3 nested {{- if }} conditionals on .Values.ingress and zero snapshot tests — charts/api/templates/ingress.yaml:1-40
No helm-unittest suite exists for this chart (checked for tests/*_test.yaml —
none found). The ingress template branches on .Values.ingress.enabled,
.Values.ingress.tls.enabled, and .Values.ingress.className with no test
fixture covering any combination. A future values change that breaks one
combination (e.g. tls.enabled=true with className unset) renders invalid
YAML or a broken Ingress with nothing catching it before it reaches a
cluster — the exact "regressions are hardest to debug in production"
pattern this domain is prone to.
role: devops-sre
```

Why it clears the bar: names the specific conditionals, states what was checked for and not found, and gives a concrete values combination that would break undetected.

## backend-engineer

Retry-safety finding — the traced sequence is the evidence:

```
[P1] Reconcile loop double-creates the child ConfigMap on requeue after a transient API error — controllers/app_controller.go:88
Reconcile() calls `r.Create(ctx, cm)` unconditionally at line 88 without a
prior Get-or-check. If the Create succeeds but the subsequent
`r.Status().Update()` at line 94 fails with a transient error (e.g. API
server timeout), controller-runtime requeues the same reconcile. The second
pass calls Create() again on an object with the same name/namespace — this
now returns an AlreadyExists error rather than succeeding, and the current
error handling at line 96 (`return ctrl.Result{}, err`) just requeues again,
looping indefinitely on a resource that already exists correctly. Needs a
Get-then-Create-if-not-found guard, or use CreateOrUpdate.
role: backend-engineer
```

Why it clears the bar: narrates the exact sequence (line 88 succeeds → line 94 fails → requeue → line 88 returns AlreadyExists → line 96 requeues again), not "might not handle retries."

## adversarial-verifier

A kill, where the oracle contradicts the claim:

```
KILLED: RDS replacement on engine_version bump — modules/db/main.tf:14
Ran `terraform plan` against the actual module: aws_db_instance.primary shows
`~ engine_version = "14.9" -> "14.12"` with actions ["update"], not
["delete","create"]. This is a patch-version bump within the same major
version (14.x), which RDS applies in-place. The finding's claim of forced
replacement is contradicted by the plan output.
```

A confirmation, where the oracle and an independent absence-check both hold:

```
CONFIRMED: No PDB, node drain outage — charts/api/templates/deployment.yaml
kube-score score output:
  [CRITICAL] deployment-has-poddisruptionbudget
  · No matching PodDisruptionBudget was found for this deployment
Confirmed replicas: 3, no PDB manifest anywhere in charts/api/templates/.
Grep across the whole chart directory for "PodDisruptionBudget" returns zero
matches. Check ID and absence both verified directly, not from the finder's
description.
```

Why these clear the bar: both re-derive the fact independently rather than restating what the finder said, and the kill cites the *specific* contradicting value (`["update"]`, not `["delete","create"]`).
