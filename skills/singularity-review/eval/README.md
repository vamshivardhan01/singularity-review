---
title: Golden dataset and regression harness for singularity-review
type: reference
scope: singularity-review
---

# Eval harness — the golden dataset

## Why this exists

Every cost and effectiveness control in this skill was **reasoned from architecture and published research, never measured on real runs.** That is the single largest open risk in the system: there is currently no way to tell whether a change to SKILL.md improved recall, hurt it, or did nothing. A skill whose entire premise is "a plausible-sounding assertion isn't evidence" cannot exempt its own tuning from that rule.

The named artifact for this is a **golden dataset**: a versioned set of representative inputs with trusted expected outputs, run as a regression suite to detect whether a prompt/model/procedure change broke known cases. Current practice treats it as the most important reliability asset in a production LLM stack — more important than any individual prompt improvement, because without it every improvement is a guess.

## What a case is

One case = one real PR with **known, human-confirmed defects**. Cases live in `cases/<repo>-pr<N>.md` with this shape:

```markdown
---
repo: example-org/platform-charts
pr: 70
head_sha: <sha reviewed>
tier_expected: default
---

## Known defects (ground truth)
1. [P2] No `required` guard on complianceScan.name/profileName — templates/clusterscan.yaml
2. [P2] Missing values.schema.json — chart root
3. [P3] cisBenchmarkVersion is dead config, never referenced in any template
4. [P3] Missing standard Helm labels on the CR

## Known non-defects (must NOT be reported)
- Absence of rancher-compliance-crd dependency — deliberate, documented in PR body
- No scheduledScanConfig knob — explicitly scoped out in the description

## Scoring
- Recall: how many of the 4 known defects were found
- False positives: findings outside the known-defect list that don't hold up
- Tier correctness: did auto-tier select `tier_expected`
- Spawns: recorded from the report's `Spawns:` line
```

**Known non-defects matter as much as known defects.** They are how you catch a change that improves recall by making the reviewer flag everything — the failure mode the calibration warning in `severity-and-dedup.md` describes.

## How to run it

1. Check out the case's `head_sha` so the diff matches what the ground truth was written against.
2. Run the skill against it.
3. Score: defects found / defects known, plus any false positives, plus tier and spawn count.
4. Record the run in `results.md` with the date and what changed since the last run.

Do this **before and after** any non-trivial change to SKILL.md or the agent files. A change that improves one case and regresses another is the normal outcome — the point is seeing it rather than assuming.

## Seeding it

Best sources of ground truth, in order:
1. **PRs where a human reviewer found real bugs** — the review comments are the labels.
2. **PRs where an automated reviewer's findings were confirmed or rejected by a human** — both outcomes are labels; a rejected finding is a known non-defect.
3. **Post-incident PRs** — a change that caused an outage is the highest-value case; the defect is unambiguous.

5–10 cases is enough to be useful. Prioritize *diversity of shape* over count: one Terraform module change, one new chart, one values-only bump, one RBAC widening, one large multi-component diff. Shape diversity is what exercises the tier/prefilter/chunking logic; ten similar cases only test one path.

## Cases available now

**`cases/pr68.md`** (repo pseudonymized as `example-org/platform-charts` inside the file) — run to completion (one chunk of two) with real cold-start VERIFY: 3/3 confirmed defects (a cluster-wide `nodes/proxy` privilege-escalation grant, a stock-defaults exporter that fails silently forever, a `serviceAccount.create=false` RBAC/availability bug), 1 confirmed non-defect. This is the first case with actual ground truth rather than hand-derived expectations, and it's also the case that measured the cost problem the token-ceiling and paranoid-prefilter fixes address: 8 spawns, ~470k tokens, ~63% of a session, still incomplete. **Re-run this case after any cost-side change and compare the new total against the number recorded in it** — that comparison is the evidence, not reasoning about the change.

Correction to an earlier prediction in this file: #68 was expected to move from `paranoid` to `default` once the RBAC signal was split into privilege-escalation vs. routine-scoped-RBAC. It didn't — and that's correct behavior, not a miss. The chart's target-allocator ClusterRole grants genuine cluster-wide `secrets` get/list/watch, which is exactly the HIGH-weight signal. The real fix verified by this case is that the tier now selects `paranoid` **for the right reason** (a real privilege-escalation grant, confirmed at VERIFY) rather than the old bug (any file named `rbac.yaml`, regardless of what it grants).

`example-org/platform-charts#70` — described but not yet written up as a `cases/` file. Four defects found and confirmed against real chart conventions on a prior PR #70 pass; the PR body documents deliberate scope decisions that make good known-non-defects. Its `Chart.yaml`-only, single-component shape makes it a good complementary case once written — it should select `default`, not `paranoid`, and is the case to catch a regression in the *other* direction (over-tiering a low-risk change).

## What to watch for in results

- **Tier drift** — `paranoid` selected on changes that don't warrant it is the primary cost failure; the RBAC signal split was exactly this bug, found by observation rather than reasoning.
- **Recall regressions after a cost optimization** — the reason the budget principle says never to cut FIND coverage.
- **False-positive growth after a recall improvement** — the two move in opposite directions; the dataset is what makes the tradeoff visible instead of theoretical.
