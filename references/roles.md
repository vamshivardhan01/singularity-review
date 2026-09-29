---
title: The four review roles
type: reference
scope: singularity-review
---

# The four lenses

Each is a distinct failure lens with its own questions — not a generic "senior engineer" merged voice. **These were originally four separate spawnable agent personas; measurement reversed that.** On `#79`, three of four separately-spawned roles independently produced the same finding (3× cost, 1 finding); on `#72`, a single agent running all four lenses in one pass found 24 candidates across the whole diff for 57k tokens, where four parallel role-spawns found only 8 across a tenth of the diff for 150k. **A merged persona satisficing after a few findings was the theoretical risk that justified keeping them separate — it didn't hold up against the measured cost of separate spawns**, so all four now live as named sections inside one agent file (`agents/infra-reviewer.md`), run together on a BROAD pass or singly on a DEEP pass. The four original personas are retained, unused, under `agents/retired/` as the pre-merge baseline.

What's still true post-merge: each lens keeps its own distinct questions and doesn't get collapsed into one undifferentiated "review this" pass — the merge changed *how many agents spawn*, not *how many independent angles get checked*. Running all four lenses in a single BROAD pass is what "flag-don't-prove" means in `SKILL.md`'s Phase 2: breadth is preserved, cost is not multiplied per-lens.

## Platform
**Owns**: blast radius, state, drift, upgrade path, day-2 ops, scalability ceilings, account-level resource quotas.
**Asks**: What does this destroy or replace? What happens on the *second* apply, not just the first? Can this be rolled back without data loss? What's the manual step during upgrade that isn't automated? Does this hold up past current load, and what's the specific ceiling if not? If this multiplies a bounded account/region resource, is capacity demonstrated for the target scale?
**Reaches for**: `blast-radius.sh`, `negative-permission-test.sh` (IAM/RBAC diffs only), `terraform.md`, drift detection.

## Architecture
**Owns**: contracts, coupling, composability, multi-account/tenant boundaries, cost, contract testability.
**Asks**: Who consumes this and what breaks when it changes? Is this boundary drawn in the right place? What's the versioning/migration story for a breaking change? (foundry's own retrospective flagged exactly this as its #1 unaddressed risk — a cross-cutting contract with no schema-version policy.) Can a consumer verify their integration before it's live? **Scope**: does this diff touch anything the PR's own stated purpose doesn't call for, and does it leave any part of that stated purpose actually unaddressed? A technically correct change can still be the wrong PR if it solves an adjacent problem instead of, or in addition to, the one it claims to. **Within a single PR that adds both a reference and the thing it should reference** (an `ExternalSecret`/`secretKeyRef` and the SOPS file it should decrypt, a `ConfigMap` key and the value that should populate it): enumerate every reference the new manifests make and confirm the referent actually ships in the same diff — a reference with no backing file is schema-valid and passes every scanner, so this enumeration is the only thing that catches it (a measured miss on a real review: three Applications referenced a secret file the PR never added).
**Reaches for**: `docs/Decisions.md` / `docs/Architecture.md` in the target repo, consumer graph, `infracost` for cost delta.

## SRE
**Owns**: rollback, probes, PDB, observability, toil, on-call pain, deploy testability.
**Asks**: How does this page someone at 3am? Is it observable — logs, metrics, traces reachable? What's the step a human will forget three months from now? Is there a way to verify this landed correctly before it's serving real traffic?
**Reaches for**: `helm-k8s.md` reliability taxonomy, `argocd-gitops.md`.

## Backend
**Owns**: API/data contracts, idempotency, error semantics, migrations, concurrency.
**Asks**: Is this operation safe to retry? What does a consumer see on partial failure? Is a schema change backward-compatible for callers still on the old version?
**Reaches for**: contract tests, consumer call sites, migration diffs.

## How findings get tagged

Every finding from `singularity-review` carries the lens that caught it (`platform`/`architecture`/`sre`/`backend`, matching `infra-reviewer.md`'s own `lens:` field) — not a role name, since there's no longer a separately-spawned identity to credit. Two lenses independently flagging the same underlying issue is a confidence signal (kept as one entry, both credited), not noise to collapse away.
