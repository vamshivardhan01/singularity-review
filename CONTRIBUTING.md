# Contributing

Thanks for looking at this. It's a small, single-maintainer tool, so the bar is informal but the review is real.

## Before you open a PR

1. **File an issue first for anything non-trivial.** A one-line fix or typo doesn't need one; a new lens, a new scanner, or a change to SCAN/FIND/REPORT does. This avoids you writing a PR against an approach that gets rejected.
2. **Read [`references/roles.md`](references/roles.md) and [`research/findings.md`](research/findings.md)** if you're touching `agents/infra-reviewer.md` or the skill files. Several past designs (four personas, per-agent evidence rendering) were tried and measured, then reverted; the reasoning is written down so it doesn't get re-proposed blind.

## Making the change

- **No new runtime dependencies without discussion.** `bin/cli.js` is deliberately Node stdlib only (see the README's Key Decisions). A new npm dependency is a bigger ask than it looks for a CLI installer.
- **Never commit real company names, AWS account IDs, internal hostnames, or personal identifiers** — including inside eval cases, examples, or research notes. This repo has had real-world leaks scrubbed out before; pseudonymize anything you paste in (`example-org`, `platform-charts`, etc.).
- Keep the [repo layout in the README](README.md#repo-layout) accurate. If your PR adds or removes a top-level file or folder, update that table in the same PR.

## Testing

- If your change touches `agents/infra-reviewer.md` or the skill files, run it against the cases in `skills/singularity-review/eval/cases/` before and after your change, and note the recall/false-positive delta in the PR description. See [`skills/singularity-review/eval/README.md`](skills/singularity-review/eval/README.md) for how.
- If your change touches `package.json` or `files`, run `npm pack --dry-run` and check the file list looks right.
- CI runs JSON/JS/shell syntax checks and a symlink integrity check automatically; make sure it's green before requesting review.

## Submitting

Open a PR against `main`. It needs one approval (from the maintainer, via CODEOWNERS) and a green CI run before it can merge — there's no way around that, including for the maintainer's own PRs from a second account.
