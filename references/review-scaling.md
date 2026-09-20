---
title: Review scaling — tiering, prefilter, chunking, token ceiling, model tiering
type: reference
scope: singularity-review
---

# Review scaling

Cost and scale mechanics for `singularity-review`. SKILL.md states the rules; this file carries the tables, thresholds, and rationale.

## Contents
- [Budget principle](#budget-principle)
- [Auto-tier risk signals](#auto-tier-risk-signals)
- [Role prefilter table](#role-prefilter-table)
- [Component chunking](#component-chunking)
- [Paranoid and the prefilter](#paranoid-and-the-prefilter)
- [Token ceiling](#token-ceiling)
- [Model tiering](#model-tiering)

## Budget principle

**Protect FIND breadth above everything.** Additional candidate *generation* returns more than additional *verification* under a real budget — "even an oracle-level verifier will fail to produce the correct answer if no correct solutions were sampled" ([arXiv:2510.14913](https://arxiv.org/abs/2510.14913)). That argument originally justified cutting VERIFY before FIND; **VERIFY is now disabled entirely**, which makes the rule absolute rather than comparative: a defect FIND never surfaces is gone, because there is no phase behind it.

So savings come from **staging** (a cheap BROAD pass, DEEP only where it flags) and from **scope**, never from what FIND examines. The historical measurements below still hold and are why: they were taken with VERIFY running, but every one of them is about FIND-side cost.

## Auto-tier risk signals

Mechanical lookup from `git diff --numstat`, the changed-file list, and SCAN/`blast-radius.sh` output. **Score risk first; size only breaks ties.**

| Signal | Weight | How to detect (cheap) |
|---|---|---|
| **Privilege escalation** | HIGH | diff *widens an existing* identity's permissions or grants broad ones: `cluster-admin`, wildcard `verbs`/`resources`/`apiGroups`, `ClusterRole`/`ClusterRoleBinding` beyond the chart's own namespace, `secrets` added to an existing Role, changed `assume_role_policy`/trust policy, new `aws_iam_*` under an iam/scp path, `iam:PassRole`/`AttachRolePolicy` added |
| Production account or environment | HIGH | prod account id / `prod`/`production` in changed path or env |
| Stateful destroy/replace | HIGH | plan shows `delete` or `["delete","create"]` on a stateful resource |
| **Routine scoped RBAC** | MEDIUM | a **new** chart/module shipping its own ServiceAccount + namespaced Role/RoleBinding with enumerated verbs on its own resources |
| Network exposure | MEDIUM | SG / route table / NACL / `0.0.0.0/0` / Gateway/LB listener change |
| Secret / credential | MEDIUM | `kubernetes_secret`, credential var, `*.sops.yaml`, new bootstrap write-role |
| ArgoCD sync-policy | MEDIUM | `prune:true` / `allowEmpty` added or changed |
| Version jump with adoption/CRD impact | MEDIUM | provider or chart **major** bump, CRD add/change |

**The RBAC distinction is load-bearing and was a measured cost bug**, not a theoretical one: treating any `rbac.yaml` as high-weight made `paranoid` the default tier for every new chart in a Helm monorepo. The question that separates the rows: *does this widen what some identity could already do, or reach outside its own namespace?* If no, it's medium.

Tier selection:
- **`trivial`** — zero risk signals AND small (`lines_changed < 50`, single module/dir, or pure docs/comment/README).
- **`paranoid`** — any HIGH signal. Size irrelevant; a one-line prod IAM grant gets the full treatment.
- **`default`** — everything else: a MEDIUM signal with no HIGH one, or a large diff with no risk signal (a 1,200-line rename is big but low-risk). **A new chart/module is `default`, not `paranoid`, purely for existing** — greenfield grants nothing it didn't already have and destroys nothing; its blast radius is bounded by what it newly asks for. It earns `paranoid` only if what it asks for is itself broad, or it touches prod/stateful resources.

If a signal is ambiguous, tier **up** — the cost of an over-review is tokens; the cost of an under-review is a missed outage.

## Role prefilter table

| Changed files match | platform lens | architecture lens | sre lens | backend lens |
|---|---|---|---|---|
| `*.tf`, `*.tfvars` | Yes | If a `module` block, `output`, or var default changed | No | No |
| `Chart.yaml`, `values*.yaml`, `templates/*.yaml` | If `count`/`replicas`/StatefulSet/PVC touched | If `values.yaml` top-level keys changed | Yes | No |
| ArgoCD `Application`/`ApplicationSet`, `kustomization.yaml` | Yes | If a generator/selector changed | Yes | No |
| IAM/SCP policy JSON or `.tf` under an iam/scp path | Yes | Yes (trust boundary is a contract question) | No | No |
| `*.go`, `*.py`, other non-manifest code | No | If it touches a cross-service call/API | No | Yes |

- A lens is named in the prompt if **ANY** changed file matches its Yes condition — recall-preserving OR, not AND.
- **When in doubt, include the lens.** This trims obvious no-matches; it is not a precision mechanism. Since the merge to one `infra-reviewer`, an unneeded lens costs a line of prompt rather than a whole spawn, so the bias toward inclusion is cheaper than it used to be.
- **`paranoid` does NOT disable this filter.** It used to, and a measured real run (`platform-charts#68`) showed the cost: `backend-engineer` spawned on a chart with zero Go/Python code, made 12 tool calls, and produced one P3 (a trailing-slash nit) for ~58k tokens. Paranoid's premise is "don't trust a shortcut on the *risk itself*" — it does not mean "every role must independently confirm irrelevance." A role that plainly cannot apply (no code for backend-engineer, no ArgoCD for devops-sre) is not a shortcut being skipped; it is work that was never applicable. See "Paranoid and the prefilter" below.
- When chunking, **re-run this per chunk against that chunk's files only** — applying the whole-diff role set to every chunk spawns roles that chunk never justified.

## Component chunking

**Diff size is the dominant predictor of review quality** — F1 drops from 0.657 on diffs <10 lines to 0.043 on diffs >150 lines ([arXiv:2606.15689](https://arxiv.org/html/2606.15689)), independent of model.

When the diff spans **more than one independent module/chart/component boundary AND `lines_changed` > ~150**, split that role's FIND spawn by boundary. Each chunk still gets full context for its own component — this splits *what is reasoned about together*, not what any spawn can see.

- **Do not split within a single cohesive module** just because it's large. The cliff is about unrelated-content dilution; slicing one module loses its internal cross-reference and gains nothing.
- **Bound the count**: chunk by top-level module/chart directory, not by file. Many components that are each trivial/mechanical (a repo-wide rename across 20 charts) → fall back to one spawn per role and say so — dilution isn't the risk when no component needs deep independent reasoning.
- **Rank chunks by risk, not just detect them.** When the token ceiling forces narrowing (below), the system needs an ordering, not just a component list. Apply the same auto-tier risk-signal table (privilege escalation > prod/env > stateful destroy > medium signals > none) *per chunk*, size as tiebreaker. This is the same mechanical lookup already run once for the whole diff — running it per-chunk instead is free, not new machinery.

## Paranoid and the prefilter

**`paranoid` disabling the role prefilter was the single most expensive line in this file, and it was wrong.** Measured on a real review (`platform-charts#68`, a new Helm chart with a cluster-wide RBAC grant — a correct `paranoid` trigger): `backend-engineer` spawned because the tier disabled the prefilter, found zero Go/Python/controller code in its chunk, made 12 tool calls anyway, and reported one P3 (a missing `trimSuffix` on a URL) for ~58k tokens. That is not "don't trust a shortcut" — the role genuinely had nothing to check. Forcing it to spawn anyway didn't buy scrutiny; it bought an agent inventing a reason to have said something.

**The fix: `paranoid` keeps the prefilter.** Since the merge to a single `infra-reviewer`, the prefilter selects **which lenses the prompt names**, not how many agents spawn — so an irrelevant lens costs a line of prompt rather than a 58k spawn. Paranoid changes *what happens to what is relevant*: every flagged cluster earns a DEEP pass, and all passes run at full model. It does not mean every role spawns regardless of whether the diff gives it anything to reason about. The prefilter's own rule already covers the risk paranoid is worried about — "when in doubt, spawn" — so a role that's a **clear** no-match (no `.tf`/chart/manifest for `platform-engineer`, no code for `backend-engineer`, no ArgoCD for `devops-sre`) stays out even at `paranoid`; a role that's ambiguous spawns, same as any other tier.

## Token ceiling — a hard cap, not a request for permission

Spawn *count* is not the cost — a spawn's **depth** is, and depth varies by 10-20× depending on the role's procedure and how much the diff gives it to chew on. Measured from real reviews:

| Agent | Tokens | Tool calls | Note |
|---|---|---|---|
| solutions-architect (FIND) | 94,587 | 58 | fetched sibling-repo design doc, searched org for consumers — the deepest, and produced the best architectural finding |
| platform-engineer (FIND) | 76,934 | 30 | negative-permission eval, full open-reasoning pass |
| devops-sre (FIND) | 82,558 | 22 | |
| backend-engineer (FIND) | 57,866 | 12 | one relevant chart, still 58k |
| adversarial-verifier ×4 (VERIFY) | 34,562 / 48,637 / 31,982 / 42,394 | 14-39 | cold-start, one per P1/P0 candidate |
| **#68 total, one chunk, 8 spawns** | **~470,000** | | **~63% of session budget, and this was incomplete** (chunk 2 unrun, several candidates still owed VERIFY) |
| **#79 total, complete review, 11 spawns** | **510,380** | | 7/7 verified confirmed, both charts covered — cheaper per unit of completeness than #68 despite a similar total |

Rough per-agent planning figures from these: **~60-95k tokens for a full-model FIND spawn**, **~20-30k for a cheap-model FIND spawn**, **~35-50k for a cold-start VERIFY spawn**. A trivial single combined pass is far cheaper than any of these — it is not doing the same depth.

**The ceiling: 15% of the available budget, default ~120,000 tokens.** That figure comes directly from the #79 measurement (510,380 tokens ≈ 63% of that session's budget → full budget ≈ 810k → 15% ≈ 121k) — treat it as the working default, and recompute proportionally if the user states a different total or remaining budget at invocation time (the same way tier-forcing or scope narrowing is stated up front). **This is a hard cap, not a question.** The earlier version of this rule asked the user and then usually got told to proceed anyway (correctly, on #79 — the findings were worth it) — which measures the number but doesn't hit the target. Hitting a stated budget requires actually engineering to it, not surfacing it and hoping.

**Before spawning — after tiering, chunking, per-chunk risk ranking, and the prefilter — project total tokens.** Sum the planning figures above across every role/chunk that would spawn under the auto-selected tier, plus one VERIFY estimate per expected P0/P1 candidate. If the projection is under the ceiling, proceed and announce the projection in one line, same as tier. If it's over, respond **in this order — breadth-preserving options first, because coverage is the expensive thing to lose:**

1. **Switch to Triage FIND** (Phase 2, SKILL.md). One shallow full-diff pass, then deep spawns only where it flags. This keeps detection coverage across the *whole* diff and stages only depth-of-proof. **Try this before narrowing** — it is the only option here that doesn't buy budget by not looking at something.
2. **Relax `paranoid`'s VERIFY-severity-tiering** back to `default`'s (self-check P2/P3, cold-start only P0/P1), keeping the tier's role set and full-model overrides. Straight from the Budget Principle: cut VERIFY's redundancy before FIND's coverage.
3. **Narrow to the single highest-risk chunk** (ranked per "Component chunking"), dropping the rest from this pass. Review that chunk at full rigor; every dropped chunk gets an explicit report line (`Not reviewed — exceeded budget ceiling, lower-risk than <chunk>`), never silently absent. **This genuinely sacrifices coverage** — measured on `#72` (3,285 lines, 43 files), narrowing to the security spine produced a strong, mutation-tested P1 but left **~90% of the diff unreviewed**, including an entire 1,700-line chart. Use it when triage is unsuitable (a single cohesive component where there's nothing to stage) or when the risk is genuinely concentrated in one place, not as the reflexive first cut.
4. **If it is still over the ceiling after all three**, stop and say so plainly: the actual number, what full coverage would need, and that further cuts mean skipping FIND coverage — which this skill does not do for cost reasons. Let the human decide. This is the one point where asking is correct, because every cheaper option is exhausted.

**Report the coverage cost, not just the token cost.** Whenever narrowing was used, the report must state what fraction of the diff went unreviewed. A review that cost 150k on a 3,285-line PR is not "3× cheaper than a 510k review of a 1,661-line PR" if it examined a tenth of the lines — presenting the token figure without the coverage figure is misleading about what was bought.

**This is still a pre-flight estimate, not a live meter — it cannot stop a review once agents are already spawned.** The per-agent tool-call budgets (~25 FIND, ~20 VERIFY) are what bound the tail once spawned, since tool-call count drove the overrun on `#68` (`solutions-architect`'s 58 calls, not deeper reasoning per call, produced its 94k) — narrowing scope before spawning and bounding depth during the spawn are two different mechanisms, both needed.

## Model tiering

**Model tiering is now per-pass, not per-role**, since one agent carries all four lenses. A BROAD pass is locating work and can run cheap; a DEEP pass carrying the open-reasoning or frame-challenge lens stays on the full model, because FIND-phase recall loss is unrecoverable — there is no VERIFY behind it.

- **Watch for `ESCALATE:`** in a cheap-model role's output — re-spawn that role at full model for the escalated topic before treating its pass as complete.
- **`paranoid` overrides tiering**: pass an explicit `model` override on the Agent call for both cheap roles. The frontmatter `model:` is a default, not a floor. Leaving two of paranoid's four roles cheap contradicts the tier's premise for the changes where a shortcut is least affordable.
