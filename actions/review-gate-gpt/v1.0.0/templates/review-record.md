## review-gate: <merge-candidate|needs-fix|needs-human|blocked>
head-sha: <FULL_40_CHAR_SHA>
target: <OWNER/REPO#PR_NUMBER>
reviewed-at: <ISO-8601 UTC timestamp>
reviewer: Review Gate GPT

### Scope
- governing-spec: <issue(s)/spec or "none identified">
- base: <base branch>
- head: <head branch>
- changed-files-reviewed: <N>
- pagination-complete: <yes|no>

### Provenance
- PR metadata: <inspected|not-inspected>
- linked issue/spec: <references inspected>
- diff/changed files: <coverage>
- surrounding repository files: <paths or none>
- existing reviews/comments: <coverage>
- checks/statuses for head SHA: <coverage>
- visual/proof artifacts actually inspected: <coverage or none>

### Verification
- static-audit: <pass|fail|partial>
- runtime-verification: <pass|fail|partial|not-performed>
- runtime-evidence: <specific evidence, or "none">

### Findings
<"None." OR repeat the block below>

#### F1 — <short title>
- severity: <blocker|major|minor|nit>
- disposition: <fix-now|defer|follow-up-issue|reject|needs-human>
- location: `<path:line/range or precise component>`
- evidence: <specific repository evidence>
- impact: <why this matters>
- required-action: <what resolves it>

### Gaps / uncertainty
- <none, or explicit missing evidence / uncertainty>

### Disposition rationale
<short explanation of why the canonical verdict follows from the evidence>

---
This Review Record is valid only for `<FULL_40_CHAR_SHA>`. Any later push invalidates it. `merge-candidate` is an independent review verdict, not merge authorization and not proof that downstream workflow gates are satisfied.
