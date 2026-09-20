---
name: building-platform-code
description: Use whenever writing or changing Terraform (.tf/.tfvars), Helm charts (Chart.yaml/values.yaml/templates), Kubernetes manifests, ArgoCD Applications/ApplicationSets, Kustomize (kustomization.yaml), or AWS IAM/SCP policy — in any repo, any org, even if not explicitly asked to use a skill. Also use when the user mentions terraform plan/apply, helm template/install, argocd sync, kubectl apply, or asks to add/change infrastructure, a chart, a module, an SCP, or a cluster resource. Applies platform-engineer, solutions-architect, devops-sre, and backend-engineer experience at design time, then runs the stack's real scanner before calling anything done.
---

# Building platform code

Four roles' hard-won experience applied *before* writing, not caught after. Reference: `references/roles.md`.

## Step 1 — Detect stack, load only what's relevant

```bash
scripts/detect-stack.sh <target-dir>
```

Load exactly one reference file based on the result — never all of them, that's the whole point of this being stack-partitioned:
`terraform` → `references/terraform.md` (+ `references/aws-org-iam.md` if the change touches IAM/SCPs)
`helm` → `references/helm-k8s.md`
`gitops` → `references/argocd-gitops.md`
`aws-iam` → `references/aws-org-iam.md`
`none` → this skill doesn't apply, stop here.

## Step 2 — Design with the four lenses, before writing code

Read `references/roles.md`. For the change about to be made, answer each role's core question in your own head before touching a file:
- **Platform Engineer**: what does this destroy or replace? Rollback path?
- **Solutions Architect**: who consumes this, what's the migration story if it changes again?
- **DevOps/SRE**: how does this page someone? Is it observable?
- **Backend Engineer** (if the change includes code, not just manifests): is this safe to retry? What happens on partial failure?

This is reasoning, not a tool call — the one step in this skill that's deliberately model judgment, because no scanner has an opinion on architecture.

## Step 3 — Write the change

Match the target repo's existing conventions (naming, module structure, chart layout) — don't introduce a new pattern the repo doesn't already use.

## Step 4 — Scan. Tools do this, not you.

**Delegation law** (`references/scanners.md`): if a tool can answer a question mechanically, a tool answers it. Never read a file to check its own syntax when a linter exists for free.

```bash
scripts/scan-terraform.sh <dir>     # terraform stack
scripts/scan-helm.sh <chart-dir>    # helm stack
scripts/scan-gitops.sh <path>       # gitops stack
```

Fix what fails, re-run, repeat until clean. Missing tool → script says so once and degrades to the remaining checks; don't manually perform what the missing tool would have checked — note the gap in the response instead.

## Step 5 — Destructive changes: stop and confirm

If the change touches a stateful Terraform resource, or an ArgoCD `prune`/`allowEmpty` flag, or a `kubectl delete`:

```bash
scripts/blast-radius.sh <dir>   # terraform — exits 2 if any delete/replace found
```

For ArgoCD, `scan-gitops.sh` flags `prune:true`/`allowEmpty:true` and tells you to run `argocd app diff --local` before merging. **A nonzero exit or a flagged prune/allowEmpty means stop and get explicit confirmation before applying** — do not proceed on your own judgment that it's "probably fine."

## Step 6 — Completion checklist (copy this into the response, tick it)

```
[ ] Scanner clean for the detected stack (or gaps explicitly noted)
[ ] Blast radius checked if any stateful/destructive resource touched
[ ] Scope — what this change does NOT own (kills scope creep; the reference codebase's #109 pattern)
[ ] Security Considerations noted, if this touches auth/persistence/transport/IAM
[ ] Matches existing repo conventions, not a new pattern
```

Anthropic's own reviewer-calibration warning applies here in reverse too: don't pad the checklist with items that don't apply to this change just to look thorough.
