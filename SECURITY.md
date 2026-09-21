# Security Policy

## Scope

This is a review-skill configuration for coding agents (Claude Code, Kiro, Codex), not a network service. The security-relevant surface is narrow but real:

- `hooks/singularity-review/guard.js` — the hard block on irreversible commands (`terraform destroy`, force-push to main, `kubectl delete ns/pv`, etc.). A gap here means a destructive command gets through instead of denied.
- Prompt-injection risk in `agents/infra-reviewer.md` or the skill files — a crafted diff or PR description that manipulates the reviewer into skipping a real issue or fabricating a false one.
- `bin/cli.js` — the installer runs on your machine and merges into `~/.claude/settings.json`. A bug that writes outside the intended config directory, or mishandles `$CLAUDE_CONFIG_DIR`, is a real issue.

## Reporting a vulnerability

Email **yvamshivardhan@gmail.com** with a description and, if you have one, a reproduction. Please don't open a public issue for anything in the scope above until it's been triaged.

You should get an acknowledgment within a few days — this is a side project maintained by one person, not a funded security team, so response time will vary.

## Not a vulnerability

Findings the reviewer misses or false-positives it reports are quality bugs, not security issues — file those as a normal [bug report](.github/ISSUE_TEMPLATE/bug_report.yml).
