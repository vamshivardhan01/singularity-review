---
title: Terraform failure taxonomy
type: reference
scope: singularity-review
---

# Terraform — killer failure modes

Ordered by blast radius. Each of these has actually taken down real infra somewhere; none are style.

## 1. Silent destroy/replace

Any attribute change HashiCorp marks "forces replacement" on a stateful resource (RDS `engine`, EBS `availability_zone`, EKS node group `subnet_ids`, most `name` fields) deletes and recreates instead of updating in place. **The plan output is the only reliable signal** — never assume from reading the diff.

- `prevent_destroy = true` in the `lifecycle` block hard-blocks a plan that would destroy the resource, even under `create_before_destroy`. The two options are independent: `create_before_destroy` changes *ordering*, it does not bypass `prevent_destroy`.
- Oracle: `terraform plan -json`, grep `actions` for `"delete"` or `["delete","create"]` (replace). This is exactly what `blast-radius.sh` automates — always run it before any apply touching a stateful resource.

## 2. Drift

Out-of-band changes (console edits, another pipeline) make state diverge from reality. Terraform's default behavior on the next apply: reconcile toward the *configuration*, which "may unintentionally destroy or recreate resources" it thinks are wrong.
- Detect: `terraform plan -refresh-only` before any real plan, especially after a manual hotfix.
- `ignore_changes` on an attribute doesn't fix drift — it hides it. Confirm it's still scoped to what it was meant for; it's a common source of "the plan says no changes" being wrong.

## 3. State handling

- Remote backend + locking mandatory — concurrent applies without a lock corrupt state.
- State stores secrets **in plaintext** (any attribute Terraform wrote, including generated passwords). Treat state file access itself as a secret-handling boundary.
- `terraform state mv/rm` must be an audited, deliberate action with a paired PR — never a silent recovery step.

## 4. Provider/module pinning

- Unpinned provider version → next `terraform init` silently pulls latest, which can break. Pin `~> 5.0` (minor-safe) or `~> 5.0.0` (patch-only) depending on how much churn is tolerable.
- **Commit `.terraform.lock.hcl`** and make sure it has checksums for every platform CI actually runs on (`terraform providers lock -platform=...`) — missing a platform breaks CI silently on next lock refresh.
- Module `source` pinned to a branch (not a tag/SHA) means the module can change under you with no diff in the calling repo. This is invisible in code review — check module blocks explicitly.

## 5. Quieter but real

- `count`/`for_each` index shift: converting a `count`-based list to add/remove a middle element re-indexes everything after it → mass unintended recreation. Prefer `for_each` with a stable key for anything long-lived.
- `local-exec` provisioners are imperative state Terraform can't track or roll back — treat any use as a flag, not a default pattern.
- Cross-account/cross-module IAM: wildcards (`Action: "*"`, `Resource: "*"`, `Principal: "*"`) and `NotAction`/`NotResource` inversions are the same failure whether hand-written or templated by a module — see `aws-org-iam.md`.

## 6. Input contract validation

A string/number variable that looks like an enum (`billing_mode`, `environment`, `instance_class` tier) but has no `validation` block accepts any value at plan time and fails — or worse, silently misbehaves — only at apply. Concretely: `aws_dynamodb_table` accepts `billing_mode = "PROVISIONED"` without complaint, but if the module never wires `read_capacity`/`write_capacity` (table or GSI) because it only ever intended `PAY_PER_REQUEST`, that "supported" value fails at apply — a gap invisible from reading the variable's description alone, only visible by checking whether every value the type/description implies is actually wired somewhere in the resource block. Check every variable whose description or name implies a fixed set of legal values: either a `validation` block restricting it to what's actually implemented, or full wiring for every value the type allows. A variable that merely *describes* a constraint in a comment without an enforcing `validation` block is not enforcing it.

## 7. Tooling/CI configuration parity

Any repo with more than one place that enumerates "the list of directories/modules this repo manages" (a `Makefile` variable, a CI workflow's hardcoded loop, a docs-generation path list, a `.pre-commit-config.yaml` include list) can drift the moment a new module is added to one and not the others. This is invisible to `terraform validate`/`checkov`/`tflint` — they only see the directory they're pointed at, never notice a directory that should have been added to their own invocation list but wasn't. When a diff adds a new module/account-root directory, explicitly grep every CI workflow file and the Makefile (or equivalent) for the *other* existing directories in the same list, and confirm the new directory was added everywhere that list is duplicated — not just in the one place (often the Makefile, since that's what a contributor runs locally) that happens to be easiest to update. A module added to local tooling but not CI means `make check` and CI stop running the same checks, and the new module's docs/lint/validate coverage silently never runs in the gate that actually blocks merge.

## 8. Stated guarantee vs. full action surface

When a diff's comments or PR description claim a specific protection ("tamper-evident," "cannot be deleted," "encrypted with this key," "immutable once written"), do not accept the claim from the presence of the obviously-named control alone — enumerate every AWS/K8s action that could defeat the stated guarantee and check the control covers all of them, not just the first one someone thought of. Concretely: a bucket policy denying `s3:DeleteObject` does nothing to stop `s3:DeleteObjectVersion` on a versioned bucket — the "tamper-evident, delete-denied" claim is false for anyone with that one additional permission, and the gap is invisible unless you ask "what's the complete list of ways to destroy this, not just the first one." Same pattern for encryption claims: a bucket-default SSE-KMS config does not guarantee every object actually uses that key if the writer's own PUT request can specify a different (or no) key — check what the actual write path sends, not just what the bucket's default declares.

## 9. Binding scope vs. permission scope — two independent axes on every identity resource

Every identity-shaped resource (IAM role, Kubernetes ServiceAccount, IRSA/Pod Identity association, any resource with a `Principal`) has two separate surfaces, and a review that only checks one has covered half the resource:

- **Permission scope**: what can this identity *do* once it holds the credential — the policy/RBAC-rules axis. This is what a negative-permission test checks.
- **Binding scope**: what can *become* this identity in the first place — the trust policy/`Principal`/RoleBinding-`subjects`/association-resource axis. A minimal, tightly-scoped permission set is still a wide-open door if anything of the right principal *type* can assume it, not just the one specific caller the diff creates it for.

A trust policy with `Principal = { Service = "pods.eks.amazonaws.com" }` and no `Condition` accepts assumption from *any* Pod Identity association in the account, not only the one association resource this same diff creates — the association is what enforces the intended binding today, but nothing stops a second association from being pointed at the same role later. Check whether the platform documents a narrowing mechanism for this exact binding type (session tags for Pod Identity, `aud`/`sub` OIDC claims for IRSA, `sourceArn`/`sourceAccount` conditions for resource policies, `subjects` scoping for a RoleBinding) and whether the diff uses it. Both axes need checking on every identity resource a diff touches — permission-scope-only review is systematically blind to this class.

## 10. Stated scope vs. implemented scope, for any specific claim a comment or description makes

Distinct from #8 (which is about a *named security guarantee*'s full action surface): this is about any comment or variable `description` that asserts a scope, boundary, or design shape at all — "one bucket, one prefix per producing system," "applies uniformly across every environment," "scoped to this account's own resources" — whether or not it's phrased as a security claim. For each such assertion, find the exact resource block that's supposed to implement it and diff the assertion's stated scope against that block's actual `filter`/`for_each`/`Resource`/`Condition` scope — not against a generic best-practices list, against the specific sentence. A header comment describing a multi-tenant/multi-producer design sitting next to a rule scoped to only one tenant/producer (`filter { prefix = "${var.one_specific_thing}/" }`) is a mismatch invisible to any scanner, because there's no external rule that says the configuration is wrong — it's only wrong relative to what the diff itself claims to be doing. This is the single most common way a review "reads" a design as sound: the prose is coherent and the code looks locally correct, and the mismatch only appears by holding both open at once.

## 11. A control this diff adds vs. the legitimate operations something else still needs

A protective mechanism (deny policy, SCP, admission webhook, `prevent_destroy`, a validating condition) is naturally checked against the threat it's meant to stop. It is *not* naturally checked against the routine, legitimate operations the same system needs to keep performing — including the diff's own write-role's future Terraform operations. A `Deny` to `Principal: "*"` on a destructive action blocks an attacker, but it equally blocks the account root and the CI write role, so it also blocks a *legitimate future replace* (rename, any force-new attribute change) of the same resource, not just teardown. This is not automatically a defect — the tradeoff can be entirely correct — but it is an undocumented operational risk if nothing in the diff says so, and the recovery path (if one exists, e.g. a narrower deny that excludes `DeleteBucketPolicy` so the policy itself can be lifted first) is exactly the kind of thing that should be one sentence in the variable/resource description, not tribal knowledge. Ask explicitly: "what other mechanism in this same system, including future applies of this same code, does this new control also apply to?"

## 12. Idempotency has three buckets, not two — a script/workflow is rarely simply "idempotent" or not

A claim like "idempotent, skips cleanly" is not verified by reading it — verify each imperative script individually against three possible buckets, since only one of them is actually safe under partial failure:

- **Genuinely idempotent**: has a skip/existence check keyed to the *exact same* resource the script's own logic finishes on last. Safe to re-run at any point, including mid-crash-then-retry.
- **Idempotent but wasteful**: no skip check, but every underlying action (a `kubectl apply` of an unchanged manifest, a declarative create-or-update call) is itself a no-op on repeat. Correct end state either way, but redoes real work — a git clone, a credential fetch, an `sts:AssumeRole` call — on every invocation whether or not anything changed.
- **Not idempotent — a real finding**: the skip/existence check is keyed to a resource the script creates *before* other side-effecting work it still has left to do. If the script dies between the checked resource and the last one, the next run's skip check sees the first resource, reports "already done," and permanently skips whatever came after — silently converting a real partial failure into a false success on retry. This is the dangerous bucket specifically because bucket 1 and bucket 3 read identically from the outside (both print a skip message and exit 0) — the only way to tell them apart is tracing the script's own control flow from the skip-check line to the last side-effecting line and asking what's still missing if it died right after the check passed.

A CI workflow or PR description asserting "all N scripts are idempotent" as one blanket claim covering several scripts is exactly the shape of claim `#10` (stated scope vs. implemented scope) already warns about — check each script against the three buckets above individually; a blanket claim being true for most of them does not mean it's true for all of them.

## 13. Module reusability is a specific, checkable property — not "looks generic enough"

A module that works correctly for its one existing call site is not automatically "reusable" in the sense the term implies. Check specifically, every time a new or substantially-changed module is reviewed: which resource names, namespaces, chart/repo URLs, and values are hardcoded literals inside the resource blocks, versus exposed as a variable with a caller-supplied override? Is every sub-resource the module creates installed unconditionally, or does the module offer a `count`/`for_each`/boolean toggle for the parts a different plausible caller (a different environment, a second region, a narrower subset of what this module bundles) might not want? Is there any values/config passthrough for chart-level or resource-level tuning the module's own hardcoded defaults don't expose? State the answer concretely — "hardcoded: cert-manager's namespace, ESO's namespace, all four chart repository URLs; exposed: chart versions, the argocd namespace; no conditional install for any of the four seed charts" — not a vague "looks reusable." A module can be entirely correct and still only usable by forking it for the next caller; that's a real maintenance/blast-radius cost worth naming even when nothing about the module is wrong for today's one caller.

## What no scanner catches here

Whether a `force-replace` is *acceptable* given the maintenance window, whether the module boundary is drawn correctly for this org's account structure, whether the migration story for a breaking module change is safe for every consumer. Checkov/tflint tell you a rule fired; only reading the actual blast radius against what this specific resource does (prod RDS vs a sandbox SG) tells you if it matters.
