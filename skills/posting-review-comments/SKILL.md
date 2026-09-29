---
name: posting-review-comments
description: Posts a user-selected subset of findings from a singularity-review report onto a GitHub PR as inline review comments. Use after running singularity-review (or when the user has a report already in hand) and the user asks to post/publish/submit comments to the PR, share findings with the team, or turn a review into PR feedback. Never posts automatically — always shows the numbered finding list and waits for the user to pick which ones go public before touching GitHub. Not for general PR commenting unrelated to a review report.
---

# Posting review comments

Turns a review report into visible PR feedback — the one step `singularity-review` deliberately never takes (it's report-only by design). This skill is the write side, kept separate on purpose: read-only review and external-visible posting are different risk classes and shouldn't share a skill.

## Step 1 — Get the report

Use a report already produced in this conversation, or run `singularity-review` first if none exists. Do not re-derive findings by re-reading the diff yourself — this skill consumes a report, it doesn't generate one.

## Step 2 — Present findings for selection, then wait

Render every finding as a numbered list using the report's own Priority/What/Where shape (`singularity-review`'s REPORT phase already formats findings this way — reuse it, don't re-derive): `N. 🔴 P0 — <what>, file:line`. **Keep each line to 1-2 sentences** — the priority, the what, and the where, nothing more. Do not paste the full Why/Fix/Evidence into the selection list; the user is picking numbers, not reading the review. Only expand a finding to its full detail if the user explicitly asks you to elaborate on it. Ask which numbers to post — plain text reply (`"2, 4"`, `"all"`, `"none"`), not `AskUserQuestion` (finding counts are unbounded, `AskUserQuestion` caps at 4 options).

**This selection is the one and only confirmation gate.** The user's reply (`"1"`, `"2"`, `"all"`) IS the authorization to post — once you have it, proceed all the way through to the actual post without asking again. Do not add a second "proceed?" / "confirm before posting?" prompt after the selection; that's the redundant double-confirm this skill deliberately does not do. No finding gets posted by default (an empty/`"none"` reply posts nothing), but a non-empty selection is a go, not a maybe.

An empty/`"none"` reply skips straight to Step 7 (Steps 3-6 have nothing to do) — log it anyway. A review whose findings were entirely declined is a real, higher-value data point than one that isn't logged at all.

## Step 3 — Resolve the target PR

If the report's target was already a PR number/URL, use it. Otherwise: `gh pr view --json number,url` for the current branch. No open PR → say so, stop here — this skill has nothing to post to.

## Step 4 — Build the findings JSON

For each selected finding, construct `{"path": "...", "line": N, "body": "..."}` — `path` relative to repo root, `line` the line number in the **new** file version (this skill always anchors `side: RIGHT`; nothing in `singularity-review`'s output describes deleted-line findings, so `LEFT` is never needed).

`body` renders the finding the way an experienced human reviewer actually writes an inline GitHub comment: a short bold title, then the minimum structure that makes it scannable. Structure fixes the old wall-of-prose failure; it is not license to write more — a structured comment can be, and usually should be, just as short as the old paragraph. **Default to the smallest shape that works; add a bullet only when prose genuinely can't carry it.**

**Default shape — title, one line, fix. No bullets.**
```
**<emoji> <priority> — <specific title naming the actual issue, not a category>**

<one sentence: the mechanism and why it matters, fused, not two clauses stapled together>

**Fix:** <the specific, concrete change, one sentence>
```
This covers most findings. Reach for more only when this genuinely can't carry the point.

**Escalation, one step at a time, only if needed:**
- One fact doesn't fit the sentence without making it run-on → **replace** the sentence with at most 2 bullets, each a fragment (5-12 words), not a restated sentence. Bullets substitute for the sentence, they don't sit alongside it — never sentence-plus-bullets.
- The claim needs a name/value to be self-evident → put it inline in backticks, in the sentence or a bullet. A separate fenced code block is reserved for a genuine multi-token snippet (a 2-line config excerpt) — reach for it rarely, and never for something a backtick phrase already covers.
- Never add both bullets *and* a fenced snippet to the same comment — pick the one the point actually needs.

**Title is a specific claim, not a label.** `**🟡 P2 — Worth checking: cross-namespace tracing backend may need a ReferenceGrant**`, not `**🟡 P2 — Configuration issue**`. The title should tell the author what to go look at before they read another word — and for a simple finding, the title plus the one-line fix may be *all* a reader needs.

**`Fix:` stays its own bold line** — fastest way for a skimming author to find the ask. **No `Where:` line** (redundant, the comment already lands on that line) and no `↳ caught by / verified` process tag (that's for auditing this system, not the PR author).

**Hard cap, always: title + ONE body slot (a sentence, or at most 2 bullets in its place) + fix.** Never both a sentence and bullets. If that one slot can't carry the point, the finding is carrying two claims — split what's separable into the summary/a second comment, or cut to the one fact that actually changes what the author does next.

Example (good — default shape, no bullets, this is the common case):
```
**🟡 P2 — Worth checking: cross-namespace tracing backend may need a ReferenceGrant**

`backendNamespace: telemetry-system` differs from this release's own namespace, and the chart's own template comment admits it's unconfirmed whether the gateway enforces a ReferenceGrant for this field — a sibling chart in this repo already has the pattern for this, this one doesn't.

**Fix:** add a `ReferenceGrant` in `telemetry-system` admitting the reference from this namespace (follow the sibling chart's precedent), or confirm on a real cluster this field doesn't need one before the sync freeze comes off.
```

Anti-patterns (both bad): (1) the old failure — one run-on paragraph with no visual break at all; (2) the *new* trap this rewrite exists to prevent — a title plus 3-4 bullets plus a fenced snippet plus a fix, which is technically "structured" but just as slow to read as the paragraph it replaced. A structured comment that's still too long has the same problem as an unstructured one.

**Findings from `singularity-review` are currently UNVERIFIED — frame them that way.** That skill's VERIFY phase is disabled by configuration, so nothing adjudicated these findings; each carries its own evidence and nothing else. Two consequences for the comment you write:
- Lead with the evidence and the mechanism, and ask for confirmation rather than asserting a verdict. "Rendering X produces Y, which would mean Z — can you confirm?" not "this is broken."
- The confidence level goes into the title line, not a separate prose lead-in: `**🔴 P0 — <title>**` for a finding whose evidence is a pasted, reproducible oracle result (the title itself asserts it); `**🟡 P2 — Worth checking: <title>**` for anything resting on a traced scenario or an interpretation, where the author's confirmation is genuinely still needed. Overstating confidence is the specific failure mode of this configuration, and a finding the author disproves costs more trust than one phrased as a question.

## Step 5 — Write the top-level review summary, then dry-run as a self-check

The review's top-level `body` (GitHub shows this as the main review comment, separate from each inline comment) is **not** a line like "N findings from Singularity Review" — that's a process label, not a review. Write 2-4 sentences of actual opinion on the PR as a whole: what the change does, your overall assessment (solid/risky/needs-work), and how the posted findings fit into that assessment (e.g. "well-reasoned overall, one citation needs correcting before merge" vs. "the core approach has a real problem — see the P0 below"). Write it the way a human reviewer types the summary box on GitHub, not the way an audit log records a finding count. Never reuse the same summary wording across different PRs/reviews — it should read specific to what this PR actually does.

```bash
scripts/post-review-comments.sh --dry-run --pr <number> [--repo owner/name] --summary "<your actual 2-4 sentence assessment of this specific PR>" <<< '<findings-json>'
```

The dry-run is a **self-check you run and review yourself, not a second confirmation gate for the user** — the selection in Step 2 already authorized the post. The script now runs a **line-resolvability preflight automatically** (in both dry-run and real mode): it parses the PR diff and hard-fails, before any POST, if any finding's `line` is not a right-side line the diff actually contains — an added `+` line or a context line shown within a hunk. This is the failure that costs a full re-post otherwise: a `path` in a *modified* file whose line sits on unchanged context *outside* every hunk (e.g. line 27 when the only hunk covers lines 12-18) is rejected by GitHub with a 422 `Line could not be resolved` that kills the whole batched review. The preflight prints the offending `path:line` and the nearest valid lines — re-anchor to one of those (an added/changed line is always safe; a newly-added file has every line valid) and re-run. You do not need to eyeball the payload for this anymore; you do still need to sanity-check that the head commit is current (re-resolve if the PR moved since the report — a stale finding on fresh code is worse than no comment). Fix any flagged anchor, then post — do not stop to ask the user "proceed?".

## Step 6 — Post

Same command without `--dry-run`. Report the returned review URL back to the user — that's the deliverable, not a summary of what was posted.

## Step 7 — Log the outcome

Append a `[posted]` entry to `../singularity-review/eval/results.md` (that file's header has the exact shape) — selected-vs-proposed counts by severity, the resulting selection rate, and the review URL (or "n/a (no findings selected)" if Step 2 came back empty). Match it to its `[review]` entry by the same date + target. This is the only place a review's real-world outcome — did the author agree with what FIND flagged — survives anywhere, and it's what `singularity-review`'s own `eval/results.md` header names as the calibration signal to watch for drift in. Log this every time, including an all-declined selection.

## Notes

- One batched review (`event: COMMENT`, one API call, one PR-timeline entry with N inline comments) — not N separate comment API calls. Matches how a human reviewer actually leaves feedback, and avoids notification spam.
- `event: COMMENT`, never `APPROVE`/`REQUEST_CHANGES` — posting findings is not a merge-gate stance; that's a separate, human decision this skill doesn't make.
- **Evidence has a shelf life — re-ground against current reality before you act.** A review is gathered at one moment and posted at another, and the target can change in between (branches moved between report and post on essentially every PR in practice). Because posting is an external, hard-to-retract action, re-read each finding against the PR's **current head** — not just re-resolve the SHA — and kill or refine the ones that no longer hold. Same principle as the stale-plan guard (a plan verified before its `.tf` changed is no longer valid): *verified-once is not verified-now.* In practice this has both narrowed a finding (a test that didn't exist at report time now did) and dropped one outright (a docstring that read as wrong in the quoted fragment was correct in full). A stale finding on fresh code is worse than no comment.
- **A finding belongs to the change that introduced it — anchor it there, or nowhere.** A comment can only land on a line the PR's own diff actually changed. A line that's unchanged (pre-existing baseline — very common in a *stacked* PR whose delta is only-vs-its-own-base) or that merely moved (a pure-rename file has no right-side diff lines) isn't this change's to own, and the preflight rejects anchoring there. If a real point lands on such a line, that's the signal it's either out of this PR's scope (it belongs to the baseline or another change) or needs re-homing to a related changed line / the summary — never force it onto code this delta didn't touch.
