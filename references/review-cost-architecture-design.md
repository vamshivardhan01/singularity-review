---
title: Review cost architecture — proposed revamp for mid/large PRs
type: design
scope: singularity-review
status: proposed, not implemented — requires sign-off before any skill file changes
---

# Review Cost Architecture — Proposed Revamp

**Status:** Design only. No skill file changes as a result of this document.
**Audience:** Whoever decides whether `singularity-review`'s cost structure gets restructured.
**Target:** ≤15% of a session budget (~121k tokens) per review, without cutting FIND coverage.

## Executive summary

Four measured reviews establish that `singularity-review`'s cost is driven by **agent turn count** and a **per-agent floor**, not by anything the existing cost controls target. The controls added so far (tiering, prefilter, chunking, model tiering, tool-call budgets) attack the *number of agents* and the *tail* of each agent's exploration. They do not touch the two largest remaining structural inefficiencies:

1. **Every FIND agent independently rebuilds the same understanding of the same files** before doing any role-specific work.
2. **VERIFY pays full cold-start price to re-confirm findings that already arrived with reproducible mechanical proof** — measured kill rate across two reviews: 1 in 10.

Addressing both, plus a triage restructure of FIND for mid/large diffs, projects a **~57% reduction** on a #79-shaped PR (510k → ~200-220k) with detection coverage preserved. This does *not* bring a genuinely large multi-component PR under 121k at full rigor; that case still requires the existing depth-first narrowing.

## Measured cost model

From four real runs (`#70`, `#68`, `#79`, `#99`):

| Agent | Tokens | Tool calls | ≈ per call |
|---|---|---|---|
| solutions-architect (#68 FIND) | 94,587 | 58 | ~1.6k |
| platform-engineer (#68 FIND) | 76,934 | 30 | ~2.6k |
| devops-sre (#68 FIND) | 82,558 | 22 | ~3.8k |
| backend-engineer (#99 FIND) | 64,634 | 36 | ~1.8k |
| platform-engineer (#99 FIND) | 68,870 | 11 | ~6.3k |
| adversarial-verifier (various) | 22,050–53,152 | 11–30 | ~1.8k |

Fitted: **cost ≈ 22k floor + ~1.7k per tool call.**

The relationship is *linear*, not the quadratic that naive agent-loop analysis predicts ([context accumulation rebills prior turns on every call](https://www.augmentcode.com/guides/ai-agent-loop-token-cost-context-constraints)) — prompt caching is already flattening it. That matters: it means **the remaining levers are turn count and the per-agent floor**, and context-compaction tricks aimed at the quadratic would buy little.

Review totals:
- `#68`: 470,000 tokens / 8 spawns — **incomplete** (1 of 2 chunks, several candidates never verified)
- `#79`: 510,380 tokens / 11 spawns — complete, 7/7 confirmed, 0 killed
- `#99`: 133,504 tokens / 2 FIND spawns + self-check — complete, 2 findings, 0 cold-start needed

## Change 1 — Route VERIFY by evidence type, not severity

**Highest-value change. Also the only one that modifies a non-negotiable's routing rule, so it needs explicit sign-off.**

### Observation

Measured cold-start kill rate: **1 of 10** candidates across `#68` and `#79`. `#79` spent **218,651 tokens on 6 verifier spawns and killed nothing.**

Examine what those findings arrived carrying. The `#79` P0 (`log_conditions` crash) came from `backend-engineer` having run the actual pinned `otel/opentelemetry-collector-contrib:0.153.0` binary against the rendered config, with the verbatim error pasted. The cold-start verifier then ran the same binary, got the same error, and confirmed — for ~53k tokens.

### The distinction that justifies the split

`adversarial-verifier.md` already states the principle for SCAN output:

> "the finder's paraphrase of that output is what you don't trust, not the mechanical tool run itself."

Refute-or-Promote's anchoring failure was **ten reviewers endorsing a plausible-sounding argument**. It was not "ten reviewers agreeing on what a deterministic command printed." Those are different epistemic objects, and the current rule conflates them by routing purely on severity.

### Proposed routing

| Finding arrives with | Route | Cost |
|---|---|---|
| Verbatim, reproducible oracle output (a command + its literal output) | Orchestrator re-runs that exact command, diffs the result. Match → `verify: oracle-reproduced`. Mismatch → escalate to full cold-start. | ~2k |
| Traced scenario, doc interpretation, consumer-graph argument, or any reasoning without a runnable oracle | Full cold-start spawn, unchanged | ~35-50k |

A new `verify:` tag (`oracle-reproduced`) keeps label integrity intact — it is *not* `cold-start`, and it is not the weaker `self-verified` either; it is a distinct, honestly-named third path.

### Cost

`#79` recosted: ~4 findings oracle-reproducible (~8k total) + 2 requiring genuine spawns (~80k) = **~88k vs 218k. Saves ~130k.**

### Risk

A finder could paste *fabricated* oracle output. Mitigation is inherent: the orchestrator re-runs the command, so fabrication fails the diff and escalates to cold-start automatically. The failure mode is a wasted 2k, not a laundered finding.

Residual risk: a finding whose oracle output is real but whose *interpretation* of that output is wrong (the output is genuine, the inference from it isn't). This is the real gap — mitigate by requiring the fast path only when the oracle output *directly* states the claimed fact (a crash message, a `kubectl` 403, a plan showing `delete`), never when the claim is an inference *about* the output.

## Change 2 — Shared evidence pack

### Observation

Every FIND agent independently runs `helm template`, reads `values.yaml`, reads the same templates, greps the same paths. In `#79`, four agents each rebuilt substantially the same picture — roughly 10-15 of each agent's ~25 tool calls were context-building, not role-specific reasoning.

### Proposal

The orchestrator builds the evidence pack **once**, before any spawn — and pays no agent floor to do it:

- Rendered manifests for every value matrix the chart ships (`ci/*.yaml`)
- Full contents of every changed file
- All scanner output (already produced in SCAN)
- The diff itself

Written to a scratch file; the *summary* passed inline to each agent, with the path available for `Read` when an agent needs surrounding context.

Each agent then starts with the picture already loaded and spends its calls on role-specific verification.

### Cost — projected ~15-25%, **measured 7.5%**

**Implemented and measured on `#99` (see `eval/cases/pr99.md`).** Same PR, same head, same two roles, same tier:

| Role | Baseline | Post-change | Δ tokens | Δ calls |
|---|---|---|---|---|
| platform-engineer | 68,870 / 11 calls | 55,931 / 5 calls | **−18.8%** | −55% |
| backend-engineer | 64,634 / 36 calls | 67,553 / 17 calls | **+4.5%** | −53% |
| **Total** | **133,504** | **123,484** | **−7.5%** | −52% |

The projection above was wrong by a factor of ~2-3. `backend-engineer` got **more expensive** despite halving its tool calls.

**Cause — an implementation error the measurement caught.** Both agents were told to *"read the pack,"* so each pulled ~70KB (~17k tokens) into context up front, where it was then re-billed every subsequent turn. The economics are asymmetric:

- **Benefit** ∝ turns eliminated
- **Cost** ∝ pack size × turns remaining after the read

`platform-engineer` amortized 17k over 5 turns → big win. `backend-engineer` carried it across 17 turns → carrying cost exceeded the ~19 calls saved.

SKILL.md had already specified the correct form (compact summary inline, full pack as an on-demand `Read`); the spawn prompts contradicted it. Now fixed, with the measured numbers written into SKILL.md so the failure mode is explicit. **The corrected form is not yet measured — the 7.5% figure is for the mis-implemented version, and the real ceiling for this change is still unknown.**

### Risk

Low on correctness. This is the existing "memory-pointer the raw output" rule extended to the whole evidence surface; the summary must stay **lossless for anything that fired**.

The measured risk is different from the anticipated one: **a badly-used pack costs more than no pack.** Any agent expected to need many turns must get the summary, not the pack. A second, subtler risk surfaced during construction — the first pack build rendered `ci/platform-alternate-values.yaml` standalone, which silently yields `stage=kubernetes` rather than the alternate-mode topology CI actually tests. Centralizing evidence centralizes evidence *errors*: one bad pack misleads every agent identically, where independent agents might each have caught it. Verify each render in the pack actually exercised what it claims before shipping it to agents.

## Change 3 — Shallow-then-deep FIND (triage lane) for mid/large PRs

### Precedent

Validated production practice, not novel: risk-analyzer front-ends that [auto-route PRs by risk dimension](https://codegen.com/glossary/code-review-agent/) report 30-50% review-time reductions. The [Triage framework](https://arxiv.org/pdf/2604.07494) routes each task to the cheapest tier whose output passes the same verification gate.

### Proposal

Replaces "4 roles × whole diff" for `default`/`paranoid` tier on mid/large PRs. Small PRs keep the current direct path — this adds a stage, and on a small diff that stage costs more than it saves.

**Stage 1 — broad, shallow.** One full-model agent, evidence pack inline, runs *all four role checklists* at **flag-don't-prove** depth. Output is candidate locations and concerns, not evidenced findings. Full detection coverage; few tool calls because it isn't proving anything. ~40k.

**Stage 2 — narrow, deep.** Spawn specialists only for what Stage 1 flagged, each scoped to its specific concern with the evidence pack already in hand. ~28k each, typically 2-3.

### Cost

~124k vs 240-320k for the current 4-role pass. **Saves ~120-200k.**

### Why this doesn't violate the Budget Principle

The Budget Principle protects *FIND coverage* — "a defect FIND never surfaced cannot be recovered downstream." Stage 1 runs every role's checklist over the whole diff, so **detection** coverage is complete. What's staged is *depth of proof*, which is recoverable: anything Stage 1 flags gets full treatment in Stage 2.

The failure mode to watch: Stage 1 flagging *nothing* in a region where a deep pass would have found something. This is the thing the eval cases must measure — see Validation.

### Risk

Real and the largest of the four. A shallow pass may not surface findings that only become visible *through* deep investigation — `#79`'s cross-chart architectural finding emerged from `solutions-architect` fetching a design doc from another repo, which is not a flag-don't-prove activity. Mitigation: Stage 1 explicitly permitted to flag "this needs a deep look and I can't say why yet from here," which is a cheap signal to emit and routes to Stage 2 normally.

## Change 4 — Trim agent files

`platform-engineer.md` is 96 lines of dense prose, re-sent as system prompt on every turn of that agent. Cut procedures to their operative instructions; move worked examples and rationale to a reference the agent reads only when it needs calibration.

Modest per-turn saving, but multiplied by turns × agents. Also directly addresses the [instruction-dilution finding](https://arxiv.org/pdf/2603.13351) already documented for SKILL.md: compliance decays as instruction count rises, and these files carry 12-step procedures with multiple mandatory sub-checks.

Estimated 15-20% reduction in per-agent base.

## Combined projection

| Review shape | Current | Projected | Cut |
|---|---|---|---|
| `#79`-shaped (2 charts, paranoid, complete) | 510,380 | ~200-220k | ~57% |
| `#99`-shaped (1 chart, default, 2 roles) | 133,504 | ~85k | ~36% |
| `#68`-shaped (1 chart, paranoid) | 470,000 | ~190k | ~60% |

## What this does NOT solve

**A genuinely large multi-component PR still will not fit under 121k at full rigor.** Three roles × three chunks with real verification is ~250k even with every change above applied. That case remains what the existing depth-first narrowing exists for: review the highest-risk component completely, report the rest explicitly as unreviewed. These changes lower the ceiling; they do not make it disappear.

**Nor does it change the eval gap.** Every figure in this document is a projection from a fitted cost model. None of it is measured post-change.

## Validation plan

Non-negotiable before any of this is trusted. `eval/cases/pr68.md` already carries confirmed ground truth (3 defects, 1 non-defect); `#79` and `#99` should be written up the same way first.

For each change, re-run the affected eval case and record:

1. **Recall** — were all known defects still found? (Change 3 is the one at risk here.)
2. **False positives** — did any known non-defect get reported? (Change 1 is the one at risk here — a fabricated or misinterpreted oracle slipping through.)
3. **Kill rate** — does evidence-type routing change how many candidates die at VERIFY? If cold-start kills rise sharply among the *reasoning-only* candidates it now handles exclusively, that validates the split.
4. **Tokens** — actual vs the projections above.

**Change 1 and Change 3 must not ship together unmeasured.** They fail in different directions (Change 1 risks false positives, Change 3 risks false negatives), and shipping both blind makes a regression unattributable.

## Recommendation

Sequence, cheapest-risk first:

1. **Change 2 (evidence pack)** and **Change 4 (trim agent files)** — low risk, no coverage implications, measurable immediately. Ship together.
2. **Change 1 (evidence-type VERIFY routing)** — biggest single saving, needs the `oracle-reproduced` tag and the "output directly states the fact" guard. Measure kill-rate and false-positive impact on `#68`/`#79` cases before trusting.
3. **Change 3 (triage FIND)** — largest restructure, largest recall risk, most valuable on exactly the mid/large PRs that motivated this. Ship last, measure hardest, and keep the direct 4-role path available as a fallback for `paranoid` on high-stakes diffs.

Do not implement all four in one pass. The eval harness exists precisely so this system stops making unmeasured changes to itself, and this document is a projection, not evidence.
