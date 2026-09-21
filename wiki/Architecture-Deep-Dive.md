> Source of truth: [`wiki/Architecture-Deep-Dive.md`](https://github.com/vamshivardhan01/singularity-review/blob/main/wiki/Architecture-Deep-Dive.md) in the main repo. Edit there, not here — this page is synced automatically on merge to `main`.

# Architecture Deep Dive

The README's mermaid diagram compresses this to three boxes. Here's what each one actually does.

## SCAN

Runs real scanners first, not the model: `checkov`, `kube-score`, `terraform plan`, `tflint`, `kube-linter`, and others depending on what stack is detected. This produces one shared evidence pack, built once, not re-rendered per lens. Before this design, FIND agents were spending 10–15 of roughly 25 tool calls just re-rendering the same chart before any lens-specific reasoning started.

Three scanners were deliberately dropped: `tfsec` (merged into Trivy, last independent release 2025-05), `terrascan` (archived by Tenable, 2025-11-20), and `datree` (archived, service sunset 2024-04). Running an archived scanner gives a stale rule set and false confidence, which is worse than not running it.

## FIND

One agent (`agents/infra-reviewer.md`), not four. It runs four named lenses in sequence:

| Lens | Owns | Asks |
|---|---|---|
| Platform | Blast radius, state, drift, upgrade path, day-2 ops | What does this destroy or replace? What happens on the *second* apply, not just the first? Can this roll back without data loss? |
| Architecture | Contracts, coupling, composability, tenant boundaries | Who consumes this and what breaks when it changes? Is this boundary drawn in the right place? |
| SRE | Rollback, probes, PDB, observability, on-call pain | How does this page someone at 3am? Is it observable before it's serving real traffic? |
| Backend | API/data contracts, idempotency, error semantics | Is this operation safe to retry? What does a consumer see on partial failure? |

Two lenses independently flagging the same underlying issue is treated as a confidence signal (kept as one entry, both credited), not noise to collapse away.

**Why one agent instead of four spawned personas:** measured directly, not assumed. On one PR, three of four separately-spawned personas independently found the same issue — 3x the cost for one finding. On another, the merged agent found 24 candidates across the whole diff for 57k tokens, where four separate personas found 8 candidates across a tenth of the diff for 150k tokens. The four lenses are real; spawning four separate agents to apply them wasn't.

**Two-stage triage on large diffs.** Narrowing scope on a 3,285-line PR reviewed only ~10% of it for 150k tokens — the old approach traded coverage for cost. Triage instead runs a cheap BROAD flag pass over the whole diff, then a focused DEEP pass only where something was flagged. This keeps 100% detection coverage; only proof-depth is staged by risk.

**Evidence handed as a summary, not read in full**, matters more than it sounds: on a real run, one agent that read the full evidence pack up front amortized the cost and came in 18.8% cheaper; another agent carried the same pack across 17 turns and ended up 4.5% *more* expensive despite making fewer tool calls.

## VERIFY (currently disabled)

`agents/adversarial-verifier.md` still exists and is one config change from re-enabled. Its job was cold-start adversarial review: a fresh-context pass whose only goal is to kill false positives before they're reported, based on the [Refute-or-Promote](https://arxiv.org/abs/2604.19049) pattern (ten independent LLM reviewers unanimously endorsed a non-existent vulnerability; it was killed only by an empirical test).

It's off because the measured kill rate was 1-in-10, for roughly 30–40% of total run cost. FIND absorbed its safety-critical jobs directly instead — counter-case search and an evidence requirement on every finding — rather than paying for a second pass with a low hit rate. See [FAQ](FAQ) for what would justify turning it back on.

## REPORT

Applies a shared severity table, caps low-priority noise, and never applies, syncs, or modifies anything on its own. Every report is evidence for the author to confirm, not an adjudicated verdict — and says so explicitly, because VERIFY being off means over-confident findings are the actual risk, not missed ones.

## Where this design came from

Every decision above traces back to a specific source, not intuition: Anthropic's own published guidance on skill authoring and reviewer calibration, community prior art (`obra/superpowers`, `anthropics/skills`, `wshobson/agents`), the Refute-or-Promote paper, and live scanner-status checks. The full citation trail lives in [`research/findings.md`](https://github.com/vamshivardhan01/singularity-review/blob/main/research/findings.md) in the main repo — it's kept verbatim rather than compressed because it's the audit trail for anyone deciding whether to trust or challenge a design choice here.
