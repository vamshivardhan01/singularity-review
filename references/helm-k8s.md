---
title: Helm / Kubernetes failure taxonomy
type: reference
scope: singularity-review
---

# Helm / Kubernetes — killer failure modes

Two taxonomies, both machine-checked (run the tool, don't recite the rule from memory):

## Reliability taxonomy — kube-score check IDs

`helm template <chart> | kube-score score -`. Full list: github.com/zegl/kube-score. The ones that actually page someone:
- `container-resources` — missing limits/requests. No limit = one pod can starve the node.
- `pod-probes` / `pod-probes-identical` — missing readiness/liveness, or readiness copy-pasted from liveness (means a slow-starting pod gets killed instead of just held out of the LB).
- `deployment-has-poddisruptionbudget`, `poddisruptionbudget-has-policy` — no PDB = a voluntary node drain (upgrade, autoscaler) can take the whole app down at once.
- `deployment-replicas` (≥2), `deployment-has-host-podantiaffinity` — single replica or all replicas on one node = one node failure is an outage.
- `deployment-targeted-by-hpa-does-not-have-replicas-configured` — static `replicas:` fighting an HPA; the two fight every reconcile.
- `deployment-strategy` — non-RollingUpdate on something that needs zero downtime.
- `stable-version` — deprecated `apiVersion`, will break on next cluster upgrade.

## Security/RBAC taxonomy — kube-linter checks

`kube-linter lint <rendered manifests>`. Full list: docs.kubelinter.io. The ones with real blast radius:
- `cluster-admin-role-binding`, `wildcard-in-rules` — RBAC that grants far more than the workload needs.
- `privileged-container`, `privilege-escalation-container`, `run-as-non-root` — container escape surface.
- `host-network`, `host-pid`, `host-ipc`, `sensitive-host-mounts`, `docker-sock` — breaks node isolation; a compromised pod owns the node.
- `env-var-secret`, `read-secret-from-env-var` — secret material in `env:` shows up in `kubectl describe`, pod spec, logs of anything that dumps env.
- `latest-tag` — non-deterministic deploys, can't roll back to what actually ran.
- `no-liveness-probe`, `no-readiness-probe` (overlaps kube-score, still worth the second engine).

## Helm-specific defects no scanner catches

- **`values.yaml` insecure by default** — a chart that's safe *if configured right* but ships defaults that aren't. Check the default, not just that a knob exists.
- **Templates that only render invalid YAML for some value combos.** `helm template` with the actual value files used in each environment is the oracle — a single default render passing proves nothing about prod overrides.
- **Missing `helm.sh/hook-delete-policy`** on hook Jobs — orphaned Job objects accumulate across every release.
- **Unpinned subchart dependency ranges** in `Chart.yaml` — same problem as unpinned Terraform providers, same fix (pin, commit `Chart.lock`).
- **`.Release.Namespace` assumptions** — a template that hardcodes or mis-derives namespace breaks the moment the chart is installed somewhere else.
- **Missing `{{- if }}` guards** on optional value maps — a consumer who omits an optional values block gets a nil-map render error, not a helpful message.

## ArgoCD/GitOps-adjacent — see argocd-gitops.md for sync/prune specifically
