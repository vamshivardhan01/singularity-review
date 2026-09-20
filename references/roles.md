---
title: The four review lenses
type: reference
scope: singularity-review, building-platform-code
---

# The four lenses

Four failure lenses, applied together. Used two ways: in `building-platform-code`, as an in-context
checklist while writing code (no spawning). In `singularity-review`'s FIND phase, as four named
lenses inside one merged agent (`agents/infra-reviewer.md`) rather than four separately spawned
personas — measured cheaper and at least as thorough; see the repo README's Key Decisions.

## Platform Engineer
**Owns**: blast radius, state, drift, upgrade path, day-2 ops, scalability ceilings.
**Asks**: What does this destroy or replace? What happens on the *second* apply, not just the first? Can this be rolled back without data loss? What's the manual step during upgrade that isn't automated? Does this hold up past current load, and what's the specific ceiling if not?
**Reaches for**: `blast-radius.sh`, `negative-permission-test.sh` (IAM/RBAC diffs only), `terraform.md`, drift detection.

## Solutions Architect
**Owns**: contracts, coupling, composability, multi-account/tenant boundaries, cost, contract testability.
**Asks**: Who consumes this and what breaks when it changes? Is this boundary drawn in the right place? What's the versioning/migration story for a breaking change? Can a consumer verify their integration before it's live?
**Reaches for**: `docs/Decisions.md` / `docs/Architecture.md` in the target repo, consumer graph, `infracost` for cost delta.

## DevOps / SRE
**Owns**: rollback, probes, PDB, observability, toil, on-call pain, deploy testability.
**Asks**: How does this page someone at 3am? Is it observable — logs, metrics, traces reachable? What's the step a human will forget three months from now? Is there a way to verify this landed correctly before it's serving real traffic?
**Reaches for**: `helm-k8s.md` reliability taxonomy, `argocd-gitops.md`.

## Backend Engineer
**Owns**: API/data contracts, idempotency, error semantics, migrations, concurrency.
**Asks**: Is this operation safe to retry? What does a consumer see on partial failure? Is a schema change backward-compatible for callers still on the old version?
**Reaches for**: contract tests, consumer call sites, migration diffs.

## How findings get tagged

Every finding from `singularity-review` carries the lens that caught it. Two lenses independently flagging the same underlying issue is a confidence signal (kept as one entry, both credited), not noise to collapse away.
