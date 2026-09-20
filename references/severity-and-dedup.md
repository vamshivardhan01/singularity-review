---
title: Severity calibration and merge rules (domain-neutral)
type: reference
scope: shared
---

# Severity calibration and merge rules

Domain-neutral. Nothing below is specific to infrastructure/platform review — any adversarial FIND→VERIFY→REPORT loop (see `adversarial-review-engine-design.md`) can point at this file directly instead of duplicating it. `singularity-review`'s own `severity.md` is a thin alias kept only so the name still resolves; every live cross-reference already points here.

## Severity calibration

Impact × Likelihood. A finding's priority comes from this table, not from how alarming the prose sounds.

| | Certain/likely | Possible | Unlikely |
|---|---|---|---|
| **Data loss / breach / total outage** | P0 | P0 | P1 |
| **Partial outage / significant degradation** | P1 | P1 | P2 |
| **Contained / recoverable defect** | P2 | P2 | P3 |
| **Cosmetic / doesn't affect correctness** | `Nit:` | `Nit:` | `Nit:` |

- `P0` — universal release blocker.
- `P1` — urgent, fix next.
- `P2` — ordinary defect, should fix.
- `P3` — low-impact, still real.
- `Nit:` — Google's convention (google.github.io/eng-practices). Optional for the author, not deleted, not blocking. Demote style/preference here instead of dropping it.

**Calibration warning**, stated because it's the documented default failure of LLM reviewers: "A reviewer prompted to find gaps will usually report some, even when the work is sound, because that is what it was asked to do." A finding earns a severity from this table or it doesn't survive VERIFY.

**Severity is an impact judgment you have to actually make — it cannot be outsourced to a tool or read off the defect alone.** The recurring way an LLM reviewer fakes this (and this system has) is substituting a proxy for the judgment. Two proxies never to mistake for a severity:
- *A tool's alarm.* A scanner/linter firing (kube-score `no-anti-affinity`, checkov `readOnlyRootFilesystem`) proves a pattern is *present*, not that it's *harmful here* — topology, intent, and blast radius are yours to weigh, not the tool's. Inheriting the alarm as a P-level is the confident-but-wrong noise VERIFY exists to kill.
- *The defect considered without its fix.* Priority also depends on whether the finding's own remedy is net-positive: score the fix against the smallest/most-constrained target it ships to. A fix that trades a frequent-failure protection for a rare one, or that breaks the constrained case, makes the finding miscalibrated — not a P2. (The underlying rule, shared with `adversarial-verifier.md`: your severity and your fix are themselves claims to be falsified, not just the author's code.)

**Likelihood with incomplete information**: if the reviewer cannot determine likelihood from available context (no live cluster/account/environment access, no way to confirm how often the triggering condition occurs), default to "Possible" and say so explicitly in the finding rather than silently guessing "Unlikely" to make a finding look more contained than it's actually known to be.

**Compound/precondition risks**: some findings aren't a direct-cause bug but the removal of a safety mechanism that only matters when a *separate*, later error occurs (e.g., a config flag that is safe alone but removes a guardrail against a future mistake). Score these on the severity of the outcome the removed safety mechanism was preventing, not on the likelihood of today's change alone triggering it — the risk is compound, not standalone, and scoring it as if today's diff is the only failure mode understates it.

## Merge / dedup rules

- Same location (file:line, or equivalent unit for the domain) + same underlying issue, flagged by more than one reviewer → **one entry**, credit all reviewers that caught it.
- Conflicting severity from two reviewers on the same issue → **take the higher**.
- Conflicting recommended fixes → **include both, attributed**, don't silently pick one.
- A finding with no concrete failure scenario and no oracle/evidence result attached does not get an entry at all, regardless of how it sounds.
