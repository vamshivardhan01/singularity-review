---
name: handing-off-context
description: Use when the session has accumulated repeated failures or edit-churn on the same file (the drift-watch hook will suggest this directly), or when explicitly asked to hand off, save progress, or start fresh. Writes a resumable handoff doc so a new session can pick up cold without re-deriving what's already been learned.
---

# Handing off context

Cost-aware — this reads the ledger a hook already wrote, it doesn't re-scan the session from scratch.

## Step 1 — Gather, via tools not memory

```bash
cat ~/.claude/state/sr-ledger-<session_id>.jsonl 2>/dev/null   # failures + churn this session wrote
git status --short
git diff --stat
```

`<session_id>` comes from context (visible in hook-injected state, or ask if genuinely unknown — don't guess a filename).

## Step 2 — Write the handoff

`~/.claude/handoffs/<YYYY-MM-DD>-<slug>.md`:

```markdown
# Handoff: <slug>
<date>

## What was attempted
<1-3 sentences, the actual goal>

## What landed
<files changed, what's confirmed working — from git diff --stat, not recollection>

## What failed and why
<from the ledger — repeated failures, edit-churn file, the actual error each time, not a paraphrase>

## Dirty state
<git status --short output, verbatim>

## Exact next step
<one concrete action, not "continue working on X">
```

## Step 3 — Print the resume line

One line the user pastes into the fresh session: `Resume from ~/.claude/handoffs/<file>.md`. Nothing else — the doc carries the detail, the message doesn't repeat it.
