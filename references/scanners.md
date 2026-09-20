---
title: Scanner invocations and the delegation law
type: reference
scope: singularity-review
---

# Delegation law (read first)

**If a tool can answer a question mechanically, a tool answers it. The model never re-derives what a linter gives for free.**

Syntax valid? `terraform validate` / `yamllint` / `helm lint` says so — don't read the file and eyeball indentation.
Schema conformant? `kubeconform` says so — don't manually check every field against the K8s API.
Will this destroy/replace a resource? `terraform plan -json` says so — don't guess from reading the diff.
Does this violate an org policy? `conftest test` says so — don't reason about Rego rules from memory.

Model reasoning is reserved for what no tool can see: blast radius in context, whether this architecture decision is right, whether the business logic is sound, whether the consumer graph can tolerate a breaking change. Every scanner below emits JSON/SARIF specifically so its output is evidence fed to the model, not a task performed by the model.

Missing tool → say so once, degrade to checklist reasoning for that check only, keep going. Never silently skip.

## Terraform

```
terraform fmt -check -recursive
terraform validate
tflint --recursive
checkov -d . --framework terraform --compact
trivy config . --severity HIGH,CRITICAL
terraform plan -out=tfplan && terraform show -json tfplan   # → blast-radius.sh
```
`tflint` = correctness/provider-aware lint (deprecated syntax, bad instance types). `checkov`/`trivy config` = security misconfig (1,020+/125+ rule modules respectively; trivy absorbed tfsec's `AVD-AWS-*` IDs 1:1). Neither substitutes for `terraform plan` — only the plan shows what will actually happen to real infrastructure.

## Helm / Kubernetes

```
helm lint <chart>
helm template <chart> | kubeconform -strict -summary -ignore-missing-schemas
helm template <chart> | kube-score score - -o human
kube-linter lint <chart-rendered-dir>
trivy config <chart>
polaris audit --helm-chart <chart>
```
`helm lint` = syntax/Chart.yaml structure only, weak. `kubeconform` = schema validity incl. CRDs. `kube-score` = reliability taxonomy (see helm-k8s.md). `kube-linter` = security/RBAC taxonomy. `polaris` = redundant-but-cheap second opinion, also runs as admission controller so same rules apply at deploy time.

## GitOps / ArgoCD

```
kustomize build <path> | kubeconform -strict
argocd app diff <app> --local <path>      # the real oracle — shows drift vs live cluster
conftest test -p policy/ <rendered-manifests>
```
`argocd app diff` is the one command that tells you what will actually change in the live cluster, including prune/delete actions — everything else is static analysis of the repo in isolation.

## AWS (live account posture, not IaC)

```
prowler aws --compliance cis_3.0_aws     # only when explicitly asked to audit a live account
infracost breakdown --path .              # cost delta on a terraform plan
```

## Dead tools — do not install or invoke

| Tool | Status | Use instead |
|---|---|---|
| `tfsec` | Deprecated, merged into Trivy May 2025 | `trivy config` |
| `terrascan` | Archived by Tenable, 2025-11 | `trivy` + `checkov` |
| `datree` | Archived, service sunset 2024-04 | `kube-linter` + `kube-score` |
