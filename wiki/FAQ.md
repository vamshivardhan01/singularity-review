> Source of truth: [`wiki/FAQ.md`](https://github.com/vamshivardhan01/singularity-review/blob/main/wiki/FAQ.md) in the main repo. Edit there, not here — this page is synced automatically on merge to `main`.

# FAQ

## Why is VERIFY disabled by default?

It was measured, not assumed: a 1-in-10 kill rate on real runs, for roughly 30–40% of total review cost. That's a bad trade for a step whose whole job is catching a small number of false positives. FIND now absorbs VERIFY's safety-critical jobs (counter-case search, an evidence requirement on every finding) directly, so the safety property didn't disappear, just the separate expensive pass. Every unverified report says so explicitly in its output.

**What would justify re-enabling it:** a case in the eval dataset where FIND's absorbed counter-case search demonstrably misses something VERIFY would have caught, or a stack/diff shape where the false-positive rate climbs enough that a second adversarial pass pays for itself again. See [Roadmap](Roadmap).

## Why one reviewer agent instead of four specialist personas?

Measured, not a stylistic preference. Three of four separately-spawned personas independently found the same issue on one PR (3x the cost for one finding). On another PR, the merged agent found 24 candidates for 57k tokens where four separate personas found 8 candidates — across a tenth of the diff — for 150k tokens. The four lenses (platform, architecture, SRE, backend) are still real and still applied; they just don't need four separate agent spawns and four separate context windows to apply them. Full numbers in [Architecture Deep Dive](Architecture-Deep-Dive).

## `bash install.sh` fails, or `npx @vamshivardhan01/singularity-review` doesn't do what I expect

`install.sh` is a two-line shim that calls `bin/cli.js` — the actual installer is Node stdlib only, no `jq` dependency. Check `node -v` is 18+. If a symlink under `skills/` looks like a plain text file containing a path instead of an actual symlink, your sync tool (some cloud-drive syncs, in particular) flattened it — this has happened to this repo before. Re-clone with `git clone` rather than a folder sync, or open an issue with what tool you used to get the files onto disk.

## Why does the installer report which scanners are missing instead of installing them?

Deliberately. It manages Claude/Kiro config, not your system package manager — silently shelling out to `apt`/`brew`/`pip` on someone's machine without asking is the kind of thing that gets a tool distrusted. Missing `terraform`/`helm`/`kube-score` etc. shows as a logged gap in the installer output and in review reports, not a silent guess.

## How does tiering (`default` vs `paranoid`) actually get decided?

By what's real, not by filename pattern matching. An earlier version tiered any file named `rbac.yaml` as `paranoid` regardless of what it actually granted — the real fix was splitting the signal into "genuine cluster-wide privilege-escalation grant" vs. "routine scoped RBAC," confirmed at review time rather than guessed from a filename. See the PR #68 case in [`skills/singularity-review/eval/cases/`](https://github.com/vamshivardhan01/singularity-review/tree/main/skills/singularity-review/eval/cases) for the specific example this was measured against.

## Can I use this without Claude Code?

Yes — `kiro/singularity-review.json` is a ready agent config for Kiro. For Codex or anything else without a sub-agent primitive, the portable core is the skills, references, and scanner scripts (plain markdown and shell); point your agent's instructions file at them and run the four lenses as sequential passes instead of spawns.
