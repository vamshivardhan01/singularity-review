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

## Step 3 — Resolve the target PR

If the report's target was already a PR number/URL, use it. Otherwise: `gh pr view --json number,url` for the current branch. No open PR → say so, stop here — this skill has nothing to post to.

## Step 4 — Build the findings JSON

For each selected finding, construct `{"path": "...", "line": N, "body": "..."}` — `path` relative to repo root, `line` the line number in the **new** file version (this skill always anchors `side: RIGHT`; nothing in `singularity-review`'s output describes deleted-line findings, so `LEFT` is never needed).

`body` is the finding's **What / Why it matters / Fix** collapsed into a single short paragraph, not the report's own multi-line labeled block — a good inline PR comment reads like a terse, direct human note, not a rendered template. Concretely:
- No bold priority header, no `**Why it matters:**`/`**Fix:**` labels, no `Where:` line (redundant, the comment already lands on that line), no `↳ caught by / verified` tag (that's for auditing this system, not for the PR author).
- Lead with `Action required — ` (or `Optional — ` for P2/P3/Nit) followed directly by the mechanism/consequence in one sentence, then the fix in one to two sentences. If there's a reasonable alternative fix, give it as a second short sentence ("Alternatively, ...") rather than a bulleted list.
- **Structure for scannability, short.** Put the fix on its own line prefixed `Fix:` so a reader sees the ask at a glance — the whole comment is the one-sentence mechanism line, then a `Fix:` line. That's the structure; do not add more headers or a Why/Where/Evidence block (the comment already lands on the line, and the reader picked it). Keep it tight enough to read in one glance.
- **Hard cap: 3-4 sentences total, ever.** State the wrong/risky thing once, state why it matters once, state the fix once — do not restate the same claim in different words across multiple sentences ("this is wrong; specifically here's what it actually says; which means the claim doesn't hold; so it should say instead..." is four sentences making one point — collapse it to one). If a first draft runs longer, the fix is to cut restatement, not to keep every sentence and hope the reader skims.
- Quote the minimum source text needed to make the claim self-evident — one short quoted fragment from the wrong claim and, if needed, one from the correct source is enough; do not quote both at full sentence length when a phrase proves the point.
- Drop `Evidence:`/oracle transcripts from the posted comment entirely — if the evidence is load-bearing for the reader to trust the claim, fold the single most relevant fact into the first sentence instead of appending a separate block.
- Keep a citation to the PR description, a linked issue, or a specific prior comment if the finding relies on it — strip everything else.

Target shape (for calibration, not a template to fill in mechanically — vary the wording so comments don't all read identically):
```
Action required — <mechanism in one sentence: what actually happens and why>. <Fix in one to two sentences — the specific change, named concretely (variable name, resource, action)>. <Optional: alternative fix in one sentence, only if genuinely useful>.
```
Example (good — 3 sentences, one point made once): "Action required — this expiry defeats the oldest-version tamper-evidence guarantee above: after 30 days it permanently removes the genuine oldest version, which a compromised auth role could otherwise have overwritten but not erased. Remove noncurrent-version expiration by default, or set it to an explicitly approved retention period. Also add `s3:DeleteObjectVersion` to the deny policy — denying only `s3:DeleteObject` doesn't stop explicit version deletion."

Anti-pattern (bad — do not write this): "Action required — this citation is wrong: X doesn't say what's claimed. Read directly, it actually says Y. That means the original claim doesn't hold. Suggest rewording to say Z instead." Four sentences, one point ("it's wrong, here's what's actually true, fix it to say that") — collapse to: "Action required — `<claim>` is wrong; `<source>` actually shows `<correct fact, quoted briefly>`. Reword to say `<the fix, stated directly, not as a suggestion to consider>`."

## Step 5 — Write the top-level review summary, then dry-run as a self-check

The review's top-level `body` (GitHub shows this as the main review comment, separate from each inline comment) is **not** a line like "N findings from Singularity Review" — that's a process label, not a review. Write 2-4 sentences of actual opinion on the PR as a whole: what the change does, your overall assessment (solid/risky/needs-work), and how the posted findings fit into that assessment (e.g. "well-reasoned overall, one citation needs correcting before merge" vs. "the core approach has a real problem — see the P0 below"). Write it the way a human reviewer types the summary box on GitHub, not the way an audit log records a finding count. Never reuse the same summary wording across different PRs/reviews — it should read specific to what this PR actually does.

```bash
scripts/post-review-comments.sh --dry-run --pr <number> [--repo owner/name] --summary "<your actual 2-4 sentence assessment of this specific PR>" <<< '<findings-json>'
```

The dry-run is a **self-check you run and review yourself, not a second confirmation gate for the user** — the selection in Step 2 already authorized the post. The script now runs a **line-resolvability preflight automatically** (in both dry-run and real mode): it parses the PR diff and hard-fails, before any POST, if any finding's `line` is not a right-side line the diff actually contains — an added `+` line or a context line shown within a hunk. This is the failure that costs a full re-post otherwise: a `path` in a *modified* file whose line sits on unchanged context *outside* every hunk (e.g. line 27 when the only hunk covers lines 12-18) is rejected by GitHub with a 422 `Line could not be resolved` that kills the whole batched review. The preflight prints the offending `path:line` and the nearest valid lines — re-anchor to one of those (an added/changed line is always safe; a newly-added file has every line valid) and re-run. You do not need to eyeball the payload for this anymore; you do still need to sanity-check that the head commit is current (re-resolve if the PR moved since the report — a stale finding on fresh code is worse than no comment). Fix any flagged anchor, then post — do not stop to ask the user "proceed?".

## Step 6 — Post

Same command without `--dry-run`. Report the returned review URL back to the user — that's the deliverable, not a summary of what was posted.

## Notes

- One batched review (`event: COMMENT`, one API call, one PR-timeline entry with N inline comments) — not N separate comment API calls. Matches how a human reviewer actually leaves feedback, and avoids notification spam.
- `event: COMMENT`, never `APPROVE`/`REQUEST_CHANGES` — posting findings is not a merge-gate stance; that's a separate, human decision this skill doesn't make.
- **Evidence has a shelf life — re-ground against current reality before you act.** A review is gathered at one moment and posted at another, and the target can change in between (branches moved between report and post on essentially every PR in practice). Because posting is an external, hard-to-retract action, re-read each finding against the PR's **current head** — not just re-resolve the SHA — and kill or refine the ones that no longer hold. Same principle as the stale-plan guard (a plan verified before its `.tf` changed is no longer valid): *verified-once is not verified-now.* In practice this has both narrowed a finding (a test that didn't exist at report time now did) and dropped one outright (a docstring that read as wrong in the quoted fragment was correct in full). A stale finding on fresh code is worse than no comment.
- **A finding belongs to the change that introduced it — anchor it there, or nowhere.** A comment can only land on a line the PR's own diff actually changed. A line that's unchanged (pre-existing baseline — very common in a *stacked* PR whose delta is only-vs-its-own-base) or that merely moved (a pure-rename file has no right-side diff lines) isn't this change's to own, and the preflight rejects anchoring there. If a real point lands on such a line, that's the signal it's either out of this PR's scope (it belongs to the baseline or another change) or needs re-homing to a related changed line / the summary — never force it onto code this delta didn't touch.
