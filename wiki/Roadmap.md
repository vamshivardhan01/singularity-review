> Source of truth: [`wiki/Roadmap.md`](https://github.com/vamshivardhan01/singularity-review/blob/main/wiki/Roadmap.md) in the main repo. Edit there, not here — this page is synced automatically on merge to `main`.

# Roadmap / open questions

This project's own rule is that a change needs evidence, not just reasoning (see [Architecture Deep Dive](Architecture-Deep-Dive)). These are the open items that rule is currently blocking on, in roughly the order they'd pay off.

## Grow the golden dataset past 2 cases

`skills/singularity-review/eval/cases/` currently has 2 cases (`pr68`, `pr99`). That's enough to catch a gross regression, not enough to trust a tuning change with confidence. The stated target is 5–10 cases prioritizing *shape diversity* over count: one Terraform module change, one new chart, one values-only bump, one RBAC widening, one large multi-component diff — because shape diversity is what actually exercises the tier/prefilter/chunking logic. Best sources, in order: PRs with real human-confirmed bugs, PRs where an automated finding was confirmed or rejected by a human, post-incident PRs.

## Revisit the VERIFY decision with real data

VERIFY is off on a measured 1-in-10 kill rate from before this repo existed independently. That measurement should be re-run against the current merged-agent FIND, on whatever eval cases exist by then, before treating "VERIFY stays off" as a permanent decision rather than a snapshot of one measurement.

## Remeasure the cost numbers in the README's Key Decisions table

The 57k-vs-150k-token and 24-vs-8-candidate numbers are real but come from specific runs, not a controlled sweep. Worth re-running once the eval dataset is bigger, to see if the gap holds, widens, or narrows as case diversity increases.

## Wire `negative-permission-test.sh` findings into `singularity-review`, not just `building-platform-code`

The script exists (`skills/building-platform-code/scripts/negative-permission-test.sh`) and is wired into the write-time skill. The research behind it — the PocketOS incident, where an agent deleted a production database and its backups in nine seconds despite explicit "don't delete production data" instructions, because a standing credential had blanket authority the system prompt couldn't override — argues just as strongly for asserting negative permissions at review time, not only while writing code. Not yet done.

## Contributing to any of these

See [CONTRIBUTING.md](https://github.com/vamshivardhan01/singularity-review/blob/main/CONTRIBUTING.md). Evidence (a real PR, a case, a measured before/after) gets prioritized over a general proposal, consistent with how this project judges its own design changes.
