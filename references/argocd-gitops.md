---
title: ArgoCD / GitOps failure taxonomy
type: reference
scope: singularity-review
---

# ArgoCD / GitOps — killer failure modes

This is the domain with the worst asymmetry between how small a diff looks and how large the blast radius is — a one-line YAML change can delete live resources.

## Prune blast radius (the big one)

By default, automated sync does **not** delete resources when Argo CD sees they're gone from Git — this is a documented safety mechanism. Turning on `prune: true` re-arms it: **a Git rebase that accidentally drops a manifest deletes the live object.** This has taken StatefulSet data with it in documented incidents.
- `PruneLast: true` applies new/changed resources before removing old ones — reduces but doesn't eliminate the risk window.
- `allowEmpty: true` on a sync policy means a sync that resolves to zero resources is allowed to proceed — it will delete **every** resource the Application owns. ArgoCD's own docs warn to set this only if that's actually intended. Any PR touching this field is an automatic stop-and-confirm.
- Oracle: `argocd app diff <app> --local <path>` before merging anything that touches sync policy or removes a manifest — shows exactly what would be deleted against the live cluster, not a guess from the diff.

## selfHeal blocks emergency response

`selfHeal: true` means ArgoCD reverts manual `kubectl patch`/`kubectl edit` changes on its own reconcile loop — including the emergency patch someone applies mid-incident. Not wrong to have on, but anyone touching incident-response runbooks needs to know it exists.

## Mutable revision targets

Tracking a branch (not a tag/SHA) on a remote Helm/Kustomize base means "manifests can suddenly change meaning, even without any changes to your own Git repository" (ArgoCD's own docs, verbatim warning). Pin remote bases to tags or SHAs, same principle as Terraform module pinning.

## Sync-wave ordering

CRDs → namespaces → secrets → consumers of those secrets. A resource applied before its dependency exists either fails the sync or (worse) succeeds against a stale/default value. Check `sync-wave` annotations on any PR that adds a new resource with a dependency.

## Other real ones

- **`ignoreDifferences` scoped too broadly** — masks real drift the same way Terraform's `ignore_changes` does; check the field path is as narrow as the actual reason for ignoring it.
- **ApplicationSet generator fan-out** — a bad selector in a generator can push one change across every cluster/tenant matched, not just the intended one. Read the generator's match criteria as carefully as the template.
- **Config repo vs source repo separation** — mixing them creates infinite CI/CD loops and muddies the audit log; flag if a PR starts writing generated manifests back into the source repo.

## What no scanner catches here

Whether the blast radius of a given sync-policy change is acceptable for *this* app's criticality, whether an ApplicationSet generator's selector actually matches only what's intended (requires reasoning about the live cluster inventory, not just the YAML), whether `allowEmpty` or `prune` were turned on deliberately or by copy-paste from an unrelated Application manifest.
