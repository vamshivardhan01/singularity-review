---
title: Research findings backing Singularity Review
type: source
scope: singularity-review
---

# Research Findings

**Type:** Research Document
**Status:** Complete, both passes conducted 2026-08-24
**Audience:** Anyone auditing a design decision in Singularity Review; this is the citation trail behind [`../README.md`](../README.md)

## Executive Summary

Two live web-research passes back every design decision in Singularity Review. Findings kept verbatim, not compressed, because this is the human-facing audit trail.

- **Pass 1** established: how Anthropic's own guidance says skills/hooks should be authored, why LLM code reviewers produce high false-positive rates and what fixes that, current infra defect taxonomies, and which IaC scanners are alive vs. dead as of 2026-08-24.
- **Pass 2** established: that prompt caching does not reduce context-window consumption (only cost/latency), which drove moving one hook from per-turn to per-session injection.
- **Most load-bearing single citation:** [Refute-or-Promote, arXiv:2604.19049](https://arxiv.org/abs/2604.19049) — the empirical basis for this system's SCAN→FIND→VERIFY→REPORT architecture.

## Pass 1 — Skill authoring, review methodology, defect taxonomies, scanner status

### Facts — Anthropic's own guidance on skill authoring

| Guidance | Detail | Source |
|---|---|---|
| Progressive disclosure, 3 levels | Metadata (name+description, always loaded, ~100 words) → SKILL.md body (loaded on trigger, target <500 lines) → bundled references/scripts (loaded on demand) | [Equipping agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) |
| Undertriggering is the default failure mode | Direct quote: "Claude has a tendency to 'undertrigger' skills... please make the skill descriptions a little bit 'pushy'." Descriptions must be third-person, list concrete trigger terms, and say "use even if not explicitly asked." | [anthropics/skills skill-creator/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) |
| References should be one level deep from SKILL.md | Nested `SKILL.md → advanced.md → details.md` gets partially read via `head -100` and silently truncated. Files >100 lines need a table of contents. | Same source |
| Low degrees of freedom for fragile operations | Pin exact scripts/commands for narrow-bridge operations (scanner invocations); leave prose judgment for open-ended reasoning (architecture calls) | Same source |
| Feedback-loop pattern endorsed | Run validator → fix → repeat, explicitly endorsed as improving output quality | Same source |
| Reviewer calibration warning | Direct quote: "A reviewer prompted to find gaps will usually report some, even when the work is sound, because that is what it was asked to do... Tell the reviewer to flag only gaps that affect correctness or the stated requirements." | [code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices) |
| Adversarial/fresh-context reviewer pattern | Direct quote: "A reviewer running in a fresh subagent context sees only the diff and the criteria you give it, not the reasoning that produced the change... have a fresh model try to refute the result, so the agent doing the work isn't the one grading it." | Same source |

### Facts — community prior art (star counts as of 2026-08-24)

| Project | Stars | Relevant pattern adopted |
|---|---|---|
| [obra/superpowers](https://github.com/obra/superpowers) | 276K | "Rationalization tables" that pre-refute excuses (e.g. "linter passed" ≠ "compiler passed"); skills-as-TDD (write a failing pressure scenario before writing the rule) |
| [anthropics/skills](https://github.com/anthropics/skills) | 171K | Official reference implementation; `skill-creator` used as the authoring template |
| [wshobson/agents](https://github.com/wshobson/agents) | 39K | `multi-reviewer-patterns` skill — dedup rule (same file:line + issue → merge, credit both), severity-conflict rule (take the higher), Impact×Likelihood table. Adopted directly into `references/severity.md`. |

### Facts — why LLM reviewers produce false positives, and what fixes it

**Refute-or-Promote ([arXiv:2604.19049](https://arxiv.org/abs/2604.19049)) — the single most load-bearing citation in this system.**

- Ten independent LLM reviewers unanimously endorsed a non-existent Bleichenbacher padding-oracle vulnerability in OpenSSL's CMS module. It was killed only by one empirical test.
- Their fix, adopted directly into `singularity-review/SKILL.md`'s four-phase architecture: Stratified Context Hunting for candidate generation, adversarial kill mandates at promotion gates, context-asymmetric cold-start verifiers, cross-model critique, mandatory empirical validation.
- Measured result: eliminated 79% of 171 candidates pre-disclosure overall, 83% on a prospective subset.
- Self-assessed conclusion, direct quote: *"No vulnerability was discovered autonomously; the contribution is external structure that filters LLM agents' persistent false positives."*

**Supporting citations:**

| Finding | Source |
|---|---|
| Separates Key Bug Inclusion (recall) from False Alarm Rate (precision) as distinct pipeline stages — conflating them in one prompt doesn't work | [Towards Practical Defect-Focused Automated Code Review, ICML 2025 Spotlight (arXiv:2505.17928)](https://arxiv.org/abs/2505.17928) |
| 76% of LLM-generated bug reports were false positives, on a Tencent industrial dataset | [Reducing False Positives in Static Bug Detection with LLMs (arXiv:2601.18844)](https://arxiv.org/pdf/2601.18844) |
| curl closed its bug bounty (Jan 31, 2026) after the confirmed-vulnerability rate on incoming reports fell from >15% historically to below 5% | Verified via [daniel.haxx.se — The end of the curl bug-bounty](https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/) (curl maintainer's own account) |
| HackerOne paused new submissions to the Internet Bug Bounty program (starting ~March 27, 2026) citing AI-amplified submission volume overwhelming triage capacity | Verified via [InfoWorld](https://www.infoworld.com/article/4154210/internet-bug-bounty-program-hits-pause-on-payouts.html) and [The Register](https://www.theregister.com/security/2026/05/21/hackerone-takes-an-axe-to-its-bug-bounty-rewards/5244458) |

**Design conclusion applied directly:** SCAN (deterministic) → FIND (high recall, 4 role agents) → VERIFY (cold-start adversarial + executable oracle) → REPORT (calibrated severity, dedup). Implemented in `singularity-review/SKILL.md`.

### Facts — domain defect taxonomy sources

| Domain | Sources |
|---|---|
| Terraform | HashiCorp docs: [lifecycle meta-arguments](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle), [provider version constraints](https://developer.hashicorp.com/terraform/language/providers/requirements), [drift](https://developer.hashicorp.com/terraform/tutorials/state/resource-drift) |
| Kubernetes/Helm | [kube-score check catalog](https://github.com/zegl/kube-score/blob/master/README_CHECKS.md) (reliability), [kube-linter check catalog](https://docs.kubelinter.io/#/generated/checks) (security/RBAC), [Helm chart best practices](https://helm.sh/docs/chart_best_practices/) |
| ArgoCD | [Best practices](https://argo-cd.readthedocs.io/en/stable/user-guide/best_practices/), [automated sync policy](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/) (the `prune`/`allowEmpty`/`selfHeal` warnings in `references/argocd-gitops.md` are direct quotes from this page), [sync waves](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/) |
| AWS | [IAM best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html), [Service Control Policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html), [Well-Architected Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html) |
| General threat modeling | STRIDE: [Microsoft Threat Modeling Tool — Threats](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats) |
| Review process convention | Google's review order (design → functionality → complexity → tests → naming → comments → style; `Nit:` prefix for demoted style): [google.github.io/eng-practices/review](https://google.github.io/eng-practices/review/reviewer/standard.html) |

### Facts — scanner status (checked live via GitHub API, 2026-08-24)

| Tool | Status | Verdict |
|---|---|---|
| trivy | Active (37.5K★, pushed 2026-08-21) | Standard — absorbed tfsec's rule catalog |
| checkov | Active (9K★, pushed 2026-08-23) | Standard |
| tflint | Active (5.8K★) | Standard |
| kube-score | Active (3.1K★) | Standard, reliability |
| kube-linter | Active (3.5K★) | Standard, security/RBAC |
| kubeconform | Active (3.2K★) | Standard, schema |
| polaris | Active (3.4K★) | Redundant-but-cheap second opinion; also runs as an admission controller |
| conftest / opa | Active (3.2K★ / 12.1K★) | Standard, custom policy |
| **tfsec** | **Deprecated** — merged into Trivy, last release 2025-05 | Use `trivy config` instead |
| **terrascan** | **Archived** by Tenable, 2025-11-20 | Use `trivy` + `checkov` instead |
| **datree** | **Archived**, service sunset 2024-04 | Use `kube-linter` + `kube-score` instead |

*Independently re-verified during a later review pass (2026-08-24, same day): tfsec/Trivy merger, terrascan archival date, and the arXiv:2604.19049 citation details (ten reviewers, OpenSSL CMS module, Bleichenbacher padding oracle) all confirmed accurate via direct search.*

## Pass 2 — Avoiding repeated context-injection cost

**Trigger:** the original hook design put charter injection on `UserPromptSubmit`, gated only by a session marker. Research question: does that actually solve the token-cost problem, and how do comparable tools solve it?

### Facts — prompt caching does not fix context-window bloat

Anthropic's [prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) state, precisely:

> `total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens`

**All three components — cached or not — count fully against the model's context-window limit.** Caching reduces dollar cost (cache reads run ~10% of base price) and latency, never window size. A hook re-injecting the same block every turn still hits the context ceiling at the same point regardless of caching.

### Facts — how Claude Code's own memory system differs

`CLAUDE.md` is loaded once at the start of every conversation, re-read from disk only at `/compact` — not re-sent per turn. This is the architectural pattern `charter-inject.js` now follows by living on `SessionStart` instead of `UserPromptSubmit`. Source: [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory).

`UserPromptSubmit` hooks have no built-in run-once mechanism for settings-file hooks — the `once: true` field exists but only applies to skill-frontmatter hooks. Idempotency for `stack-switch-inject.js` was built by hand via state-file comparison. Source: [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks).

### Facts — how other agentic tools handle the same problem

| Tool | Approach | Assessment |
|---|---|---|
| Cursor (`.cursorrules`/`.cursor/rules`) | Fires on every matching interaction, no first-party dedup | Anti-pattern this system avoids; community guides call this a "token tax" ([datacamp.com/tutorial/cursor-rules](https://www.datacamp.com/tutorial/cursor-rules)) |
| Aider | `--cache-prompts` + stable repo-map/read-only file set between requests | Framed by its own docs as a *cost* fix ("30–70% savings on long sessions"), explicitly not a window-size fix ([aider.chat/docs/repomap.html](https://aider.chat/docs/repomap.html)) |
| Cline | Memory Bank persists state in the repo; "Focus Chain" re-injects a small todo list on a cadence; auto-compaction summarizes near the limit | Closest validated analog — the one legitimate periodic-reinjection pattern found ([cline.bot blog](https://cline.bot/blog/how-to-think-about-context-engineering-in-cline)) |

### Facts — academic consensus

Hierarchical/bounded memory with eviction, not blind per-turn injection:

- [arXiv:2607.07666](https://arxiv.org/abs/2607.07666) — hierarchical memory, ~300 median tokens across long runs via capping + eviction
- [arXiv:2601.07190](https://arxiv.org/abs/2601.07190) / [arXiv:2605.23296](https://arxiv.org/abs/2605.23296) — context compaction for long-horizon agents; treats summarization/eviction as the real lever since caching only optimizes re-compute
- [arXiv:2603.29194](https://arxiv.org/abs/2603.29194) — working/episodic/semantic memory separation to bound growth

### Recommendation — ranked injection strategy, as applied

1. **Inject once at session start** for static standing instructions (the `CLAUDE.md` pattern) → `charter-inject.js` on `SessionStart`.
2. **Inject on state change only** for conditionally relevant context → `stack-switch-inject.js` and `drift-watch.js`, both gated on an actual state comparison, zero tokens otherwise.
3. **Periodic/N-turn re-injection** only for things proven to decay from attention (Cline's Focus Chain analog) — not used in this system; nothing here needs it.
4. **Inject every turn unconditionally** — the anti-pattern (Cursor's documented "token tax"), deliberately avoided throughout.

This ranking is this document's own synthesis of the facts above, not a direct quote from any single source.

## Pass 3 — Adoption research: what's new in the field since this system was built

**Trigger:** explicit request to research current practices in LLM-review/agentic-IaC and adopt anything genuinely applicable.

### Facts — AI-generated infrastructure code security ceiling

Veracode's Spring 2026 GenAI Code Security Update (80 tasks, 4 languages, 150+ LLMs) found a **55% secure-code ceiling that has not moved in two years** despite model scale increases — reasoning models reach 70–72%, still a ~28% failure rate on security-critical generation tasks. Source: [goranstimac.com — AI-Generated Infrastructure Code: The 2026 Governance Gap](https://goranstimac.com/blog/ai-agents-infrastructure-code-governance-2026/). This reinforces, rather than changes, this system's existing design: the SCAN phase's mandatory real-scanner-before-model-judgment rule (`references/scanners.md`) is the correct response to a ceiling that model improvement alone won't close.

### Facts — the PocketOS incident and negative permission testing

On 2026-04-25, an AI coding agent deleted a production database and all its backups in nine seconds, with no prompt injection, no attacker, and explicit "don't delete production data" instructions in its system prompt. The agent hit a credential mismatch, reasoned its way to deleting a volume as a fix, and found a standing token with blanket API authority in the codebase. Source: [KodeKloud — Least Privilege for AI Agents](https://kodekloud.com/blog/least-privilege-for-ai-agents-securing-kubectl-terraform-and-cloud-clis/), cross-referenced against the Coalition for Secure AI's March 2026 agentic-IAM guidance (cited in the same article) and Sonrai Security's finding that 92% of cloud identities are overprivileged with only 44% of organizations having any agent-specific access policy.

**Direct quote, the core lesson:** *"A system prompt is advisory and a credential is enforceable... Instructions live inside the model's reasoning loop, which means the model can reason its way around them when a goal seems to demand it."*

**Adopted:** `negative-permission-test.sh` — asserts what a role/ServiceAccount must never be able to do (`kubectl auth can-i` for k8s, IAM policy simulator for AWS), rather than asserting it can do its job. This is the only check that catches privilege creep after the fact: a role widened by an unrelated PR still passes every positive capability test, and only fails a negative assertion. Wired into `platform-engineer.md` as step 9, gated on IAM/RBAC-touching diffs only.

### Facts — Claude Code platform capabilities added since this system's original build

Verified directly against [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks) (current as of this research pass): the hook event set has grown to 30+ events, including several with no equivalent when `singularity-review` was designed:
- `PostToolBatch` — fires once after a full parallel tool-call batch resolves, before the next model call. A better injection point than per-tool `PostToolUse` for anything reacting to "the parallel FIND phase just finished" as a single event.
- `SessionEnd` — fires on session termination; didn't exist as a documented, reliable hook point previously. Would close the state/ledger-file-accumulation gap flagged in an earlier review pass this session (currently relies on `install.sh`'s 30-day mtime prune as the only cleanup mechanism).
- Agent-type hooks (`type: "agent"`) — a hook handler can now spawn a real subagent with tool access (up to 50 turns) to verify a condition before returning an allow/deny decision, natively, for `PreToolUse`/`Stop`/and other events. This overlaps with what `adversarial-verifier` currently does via skill-prose instruction — an agent-type hook could make VERIFY structurally enforced (the action literally cannot proceed without a verifier's assent) rather than relying on the skill's phases being followed correctly by the orchestrating agent.

**Not yet adopted** — presented to the user as options requiring a decision, not implemented in this pass, since each is a platform-capability bet (whether to move from skill-prose orchestration to native hook enforcement) rather than a pure research-backed improvement like the negative-permission pattern.

### Sources checked and deliberately not adopted

- Agent Teams (peer-to-peer subagent messaging, shipped March 2026) — solves a coordination-overhead problem this system doesn't have; the four FIND roles don't need to message each other, VERIFY's isolation from FIND's reasoning is a deliberate design choice this would undermine, not a limitation to remove.
- "Policy as code enforced before generation" (pre-plan OPA/Sentinel gates) — already substantially covered: `guard.js` gates before execution, and the terraform-plan/apply-split pattern this research surfaced is already this system's default posture (`guard.js` denies unplanned apply).
- The delayed-verification-instability paper (arXiv:2606.27409) — mathematically rigorous but its own conclusion is that *grounded* verification (checking against an oracle, not a signed scalar belief debated over rounds) is stable regardless of delay. This system's VERIFY phase is already oracle-grounded, so the paper validates the existing design rather than motivating a change.

## Pass 4 — Scoping PostToolBatch and agent-type hooks against this system's actual hooks

**Trigger:** explicit request to scope both platform capabilities flagged undecided in Pass 3 — usefulness for this system specifically, and the tradeoff of each. Verified against [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks) and [code.claude.com/docs/en/hooks-guide](https://code.claude.com/docs/en/hooks-guide) directly (the reference page's `PostToolBatch` row and the guide's full "Agent-based hooks" section), not from Pass 3's summary — Pass 3's framing turned out to need correction on one point (below).

### PostToolBatch

**What it actually is, verbatim:** "After a full batch of parallel tool calls resolves, before the next model call." Can block (exit code 2 stops the loop). The reference does not document whether Task/Agent tool-call batches (subagents spawned via the Agent tool, like FIND's four parallel role agents) trigger it the same way direct tool batches (parallel Bash/Read/Write) do — this stayed unverified after two fetches of the primary source; the docs simply don't say.

**Checked against every `PostToolUse`-firing hook this system actually has:**
- `mistake-ledger.js` and `scan-on-write.js` both fire per-tool-call on `PostToolUse(Write|Edit)`, and both *need* that granularity, not batch granularity. `mistake-ledger`'s churn tracking counts edits per individual file (`drift-watch.js`'s `maxChurn` groups by `target`); `scan-on-write`'s debounce keys are per-file. Collapsing either to one event per batch would need the batch payload to break back out per-file to preserve current behavior — at best a wash, not a win, and adds a dependency on an undocumented-for-our-case trigger condition.
- The one plausible new use — auto-detecting "the FIND phase's four parallel role-agent spawns just finished" as a single event, to log something without the orchestrating skill needing to say so — has no current problem behind it. `singularity-review/SKILL.md`'s Phase 2→3→4 sequencing already works via the skill's own step-by-step instructions; there's no observed missed-transition bug this would fix. Speculative value, the same premature-abstraction shape already correctly declined once in `adversarial-review-engine-design.md`.

**Verdict: do not adopt.** No hook in this system has a granularity problem PostToolBatch solves, and the one hypothetical use case is a solution without an observed problem. Revisit only if a future hook genuinely needs "react once after a batch," which none of the current five do.

### Agent-type hooks

**What it actually is, verbatim from the guide** (correcting Pass 3's framing, which implied a straightforward swap-in):
> "Agent hooks are experimental. Behavior and configuration may change in future releases. **For production workflows, prefer command hooks.**"
> Response format is `"ok"`/`"reason"` — not the `hookSpecificOutput.permissionDecision` schema `guard.js` uses today, so this can't extend `guard.js` in place; it would need to be a separate hook entry.
> Tool access: "can read files, search code, and use other tools" in the guide's prose, but the hooks reference page states the access more narrowly as "Read, Grep, and Glob" explicitly. **This discrepancy is unresolved** — if agent hooks truly cannot run Bash, they cannot invoke `terraform show`/`kube-score`/any real scanner, which would rule out the one thing that would make them valuable for *this* system (oracle-grounded checks, not just file reading). Worth a throwaway test before committing to a design either way.
> 60s default timeout, up to 50 tool-use turns, per invocation. `PreToolUse` with `ok: false` denies the tool call for real (same underlying deny as a command hook) — Pass 3's "no equivalent when this system was built" framing was right that this is genuinely new, but "the action literally cannot proceed without a verifier's assent" undersold the actual behavior: the *tool call* is blocked either way, the turn then continues so Claude can adjust, rather than ending — closer to a good UX property than a caveat.

**The concrete gap that motivated Pass 3's interest, checked directly against `guard.js`:**
```
$ terraform apply this-plan-file-does-not-exist.tfplan   → currently ALLOWED
```
`terraformApplyHasPlanArg()` only checks that *some* non-flag token follows `apply` — it never verifies the named file exists, or that it's still current. Reproduced: a genuinely nonexistent path is caught for free by Terraform's own hard error on a missing file (`no such file`) — not actually dangerous. But a **stale** plan file — real, on disk, generated before the `.tf` files it was supposedly planning against last changed — passes both checks and applies successfully against config it no longer matches. That's the real unguarded case.

**Verdict: do not adopt an agent hook for this.** The gap is real, but closing it doesn't need an LLM in the loop — it needs a file-mtime comparison, which a plain deterministic check does for free, faster, and without depending on an explicitly-experimental mechanism Anthropic itself says to avoid in production. Implemented directly instead: `guard.js` now denies `terraform apply <planfile>` when the plan file's mtime predates the newest `.tf` file in the same directory (see commit). This is the actual output of scoping this capability — not adopting agent hooks, but a concrete fix the exercise surfaced.

**When agent hooks would earn a second look:** if a future need requires judgment a deterministic check can't express — not "is this file stale" (mtime answers that for free) but something like "does this plan's actual diff match what the PR claims it does," which is a real reasoning task. Revisit then, and resolve the Read/Grep/Glob-vs-Bash tool-access question with a direct test before designing around it either way.

## Pass 5 — Review-process lessons from production use (2026-09-03)

Lessons from running the skill on real PRs (aws-workloads, platform-gitops, platform-charts). **Each is stated as the underlying failure mode — the reason the mistake was possible — not the specific instance, so it catches the class rather than only the recurrence; the incident is cited as evidence.** Each was persisted as a behavior change in the skill/agent/reference files; this section is the provenance record, not the enforcement.

**1. Asymmetric skepticism — the review falsifies the author's code but not its own conclusions.** The engine spends all its rigor deciding "is the author's code wrong?" and almost none on "is my *severity* right, is my *fix* right?" — so an unfalsified assertion ships because it wears the reviewer's badge instead of the author's. Two forms: inheriting a tool's alarm as a severity (a scanner reports a pattern is *present*, never that it's *harmful here*), and proposing a fix that's a net-negative even when the defect is real (the remedy was never tested against the deployment reality). *Evidence:* platform-charts#61 anti-affinity — kube-score flagged it, the mechanism was real, the cold-start verifier CONFIRMED it, yet the recommended fix (`DoNotSchedule`) regresses a one-node cluster. *Persisted:* `adversarial-verifier.md` step 6 + `severity-and-dedup.md` — your severity and your fix are claims to be falsified too.

**2. Acting on stale evidence — "verified once" treated as "verified now."** Any gap between when evidence is gathered and when an irreversible/external action is taken is a place for reality to change underneath the conclusion. *Evidence:* posting review comments after the branch moved (heads moved on essentially every PR this session); the #86 re-review refined one finding and dropped another after re-reading at the current head. Same principle the stale-plan guard already encodes for `terraform apply`. *Persisted:* `posting-review-comments` SKILL — re-ground at current head before posting.

**3. Wrong-baseline attribution — blaming a change for what its context already contained.** A finding is only valid against the change that actually introduced it; diffing against a convenient default instead of the true unit of change misattributes baseline state to the diff. *Evidence:* the #59/#60 stack — a pre-existing gate-job line flagged as if #60 introduced it, and a pure-rename SOPS file with no anchorable line. *Persisted:* reviewing SKILL "Determine the target" + `posting-review-comments` SKILL — attribute (and anchor) only to the introducing change, against its own base.

**Also shipped this session (capability, not a mistake):** the frame-challenge / goal-vs-mechanism pass (solutions-architect step 9a, platform-engineer step 12, SKILL FIND/REPORT), after the review missed two frame-level alternatives on platform-charts#60 (in-cluster CronJob vs an out-of-cluster workflow; a shared org build-workflow vs a bespoke one). Gated to fire only when a PR introduces/restructures a mechanism; weighted on cost/reward + foreseeable-future + production-readiness.

**Session drift check (manual — hooks dormant under Kiro, no runtime ledger):** low. The numeric proxy (failures ≥5 or maxChurn ≥4) would trip level 1, but the churn was intentional iterative feature-building and most "failures" were the posting preflight rejecting bad anchors before any 422 (working as designed). One real reasoning miss (anti-affinity, above), caught in review and retracted — no fresh session warranted.

## Pass 6 — Design-doc FIND scope was narrower than the target warranted (2026-09-03)

**4. Under-scoped FIND on a non-code target — the agents' procedures assume an oracle-backed diff, and a docs/design target quietly falls back to "fact-check only what the doc cites as verified" instead of the full adversarial job.** aws-workloads#82 (a 545-line production EKS design doc, docs-only) was reviewed with the three design-review roles, and every claim the doc *itself* cited evidence for was independently re-verified and held up. A second, independent reviewer (`ajit3259`, on a companion PR referencing the same doc) then found five real defects the FIND pass missed, all fixed by the author. Reading each miss against what was actually instructed showed the root cause was scope, not tooling: the FIND prompts asked agents to fact-check *the doc's own cited figures*, check consistency on *the three decisions the doc itself labeled as reversals*, and fact-check *the doc's own literal claims about existing bootstrap policy coverage* — three different narrow apertures, each satisfied competently, none of which was "adversarially check the doc's own internal coherence and every claim against the real world," which is what a doc with no `terraform plan` to catch it downstream actually needs. Concretely, all five misses share one of three shapes:
  - **Fact-check breadth**: doc verified the primary instance-type family's IOPS baseline live; the *fallback* instance type named two sentences later (`m7a.*`) was never independently checked and turns out unavailable in the deployment region (`describe-instance-type-offerings` returns nothing; `describe-instance-types` returns `InvalidInstanceType`) — the fallback existed only in text, silently invalidating the mitigation the paragraph claimed to provide.
  - **Cross-section consistency breadth**: the consistency check grepped for stale *topology* terms (the three named reversals) and reported PASS; it never diffed the doc's new TLS/edge-model section against the existing doc's *still-standing* proxy-mode/certificate tables on an orthogonal axis (Cloudflare proxy mode, ACM vs Origin CA) — two documents fully consistent on topology, self-contradicting on edge security. Same shape hit a checklist-vs-target-list completeness gap (§8's implementation checklist named 4 of 8 endpoint services §2 promised) and a stale "don't add ECR/STS" line in the older doc that directly contradicted the new doc's opposite recommendation.
  - **Grant-vs-requirement tracing**: platform-engineer fact-checked the *literal* bootstrap-policy claim ("cp accounts have no EKS/ECR policy yet" — true) but never traced the *new customer-managed KMS key* the checklist introduces against AWS's documented requirement that `AWSServiceRoleForAutoScaling` needs an explicit grant on customer-managed (not AWS-managed) keys — a real, well-documented AWS gotcha that fails silently at `terraform apply` and only surfaces later as node-launch failures. Same shape on IAM ownership: a new ECR write permission was checked against "does the consuming account need this to work" (yes) rather than "does the consuming account *own* the resource this grants access to" (no — the registry-owning account does), so an over-broad-but-functional grant passed.
**Why steps 1-11/9/12 in the individual agent files didn't catch this:** those procedures are correct and were followed — but every one of their oracles (`terraform plan`, `kube-score`, `describe-instance-types` against *a cited example*) implicitly assumes the reviewer already knows which specific claims to point the oracle at. For a code diff, "which claims" is bounded by the diff's own resource blocks. For a design doc, the doc can name far more real-world specifics (instance families, cert authorities, existing policy coverage) than any one procedure step enumerates, and nothing previously told the orchestrator (this session) to broaden the aperture rather than run the existing procedures once each. *Persisted:* `skills/singularity-review/SKILL.md` Phase 2 — a new instruction block, used only when the target is a design/architecture doc rather than an oracle-backed diff, telling the orchestrator to explicitly widen at least one spawned role's brief to (a) re-verify every literally-named resource/version/identifier in the doc, not just its cited examples, (b) cross-check every pair of sections describing the same subsystem from a different angle, not only doc-labeled reversals, and (c) trace every new credential/key/identity against its consuming service's own documented grant requirements, not just the doc's stated intent for it.

## Pass 7 — Same PR, second post-review external audit found six more real defects, including the cold-start verifier itself being wrong (2026-09-04)

**5. Cold-start verification is only as good as the verifier's mental model of the mechanism — and reasoning from a plausible model instead of the vendor's own doc is the ten-reviewers failure relocated, not avoided.** aws-workloads#79 (the generic `modules/s3-export`) was FIND+VERIFY'd twice by this system across its two revisions, and on both passes the platform-engineer FIND/VERIFY concluded the Roles Anywhere same-CA-shared-across-two-trust-anchors design was safe because "distinct trust-anchor ARNs make the isolation real, since `aws:SourceArn` is scoped to the anchor, not the CA." An external human reviewer (`ajit3259`) then found this conclusion was backwards: fetching AWS's own Roles Anywhere trust-model docs directly (this session, in response) confirms `CreateSession` validates a presented certificate against **the CA the target trust anchor is configured with**, not against which anchor "issued" a session — so two trust anchors referencing the *same* CA both accept *any* certificate from that CA, regardless of which one a client nominally targets. AWS's own docs go further: they explicitly recommend pairing `aws:SourceArn` with a `PrincipalTag/x509.../CN` condition specifically to prevent this "confused deputy" shape — i.e., AWS itself documents that `SourceArn` alone, with a shared CA, is insufficient, which is the literal opposite of what both prior verification passes concluded. Five *other* real defects surfaced in the same external review, all missed across both of this system's own passes: a bootstrap CI-write-role with no policy file covering the new module at all (the merge-triggered apply cannot create what the diff declares); a KMS grant on an *adopted* bucket that targets this module's own CMK instead of the bucket's real owning module's CMK (silent `AccessDenied` at runtime, invisible to `terraform plan`); a `kms_prevent_destroy` toggle that routes between two *different* KMS resource addresses (destroy-and-recreate, not an in-place protect, unrecoverable for existing encrypted objects); and two README/docs staleness defects (an example using an obsolete input shape, import instructions targeching a `for_each` address that `create=false` excludes).
  - **Root cause 1 (the KMS-grant-vs-real-consumer and destroy-toggle misses):** both are variants of a check this system had *only* encoded for design-doc FIND (Pass 6, "trace every new credential/key against its consuming service's own documented grant requirements") — that lesson was scoped to the docs-review instruction block in `SKILL.md` Phase 2 and never generalized into the standing agent procedures (`platform-engineer.md`) that run on every real Terraform diff, so the identical failure shape recurred in code one PR-revision later with no procedural check to catch it. *Persisted:* `agents/platform-engineer.md` step 6 — a new named check for grant-vs-real-consumer tracing whenever a resource is adopted (`create = false`/`manage_config = false`) rather than created, since the adopting module's own `terraform plan` never reflects the adopted resource's actual out-of-band owner/config. Also step 5 — tightened the existing count-based-reindex checklist item to name the more dangerous variant where a boolean toggles between two *different* resource addresses entirely (a "protect this key" toggle that is actually destroy-and-recreate), since the existing wording only covered a count expression changing on one resource.
  - **Root cause 2 (the bootstrap CI-role gap):** no check anywhere in the system's procedures ever looks at the *separate* diff that grants the CI identity permission to apply what a module diff declares — every check is scoped to the module/account-root diff in isolation. This is a genuinely new class of check, not a generalization of an existing one. *Persisted:* `agents/platform-engineer.md` step 5 — a new named checklist item: when a repo convention has a per-module bootstrap write-policy file, check the new module has one, and that it actually grants (not merely "a broad KMS/API statement elsewhere ceilings it") every specific create/manage/PassRole action the new resources need.
  - **Root cause 3 (the trust-anchor mechanism miss — the most consequential, since it happened *inside* the adversarial-verifier's own cold-start, which is supposed to be the failure-catching step, not a failure source):** `agents/adversarial-verifier.md`'s oracle list (step 2) had no entry for "a claim about how a specific AWS service actually validates/scopes a request" — so when platform-engineer's FIND and then the adversarial-verifier's own cold-start both needed to judge a Roles Anywhere trust claim, both reasoned from an internally-plausible model of the mechanism (distinct ARNs ⇒ distinct trust) instead of checking AWS's own documented behavior, and both got the same wrong answer independently — which is *worse* than the single-reviewer version of this failure, since cold-start's entire premise is that a fresh check catches what an anchored one misses, and here the fresh check inherited the same unexamined mental model rather than the finder's specific reasoning. *Persisted:* `agents/adversarial-verifier.md` step 2 — a new oracle-selection entry: any claim about AWS trust/validation-mechanism behavior (Roles Anywhere, Pod Identity/IRSA, STS condition evaluation, KMS grant/key-policy order, SCP/boundary intersection) must be checked against the vendor's own documentation before ruling, explicitly naming that reasoning from a plausible mental model of the mechanism is the ten-reviewers failure relocated into the verifier itself, not avoided by the two-phase architecture.
  - **Root cause 4 (docs staleness, minor):** confirms the P2 finding from this same PR's *first* review (the CI docs-currency check omitting this module) was the right thing to flag and is now more urgent — no other mechanism in the system ever diffs a module's README examples/instructions against its own current schema/resource logic, and CI's docs-currency check is the one thing that would.
