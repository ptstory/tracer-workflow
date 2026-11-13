# review-gate prompt

Paste into a **fresh** ChatGPT/Claude web session (GitHub connector required, with
comment-write access). Fresh session is deliberate — it reviews the PR against the
issue as written, carrying none of the planning thread's assumptions. Replace
`<PR_URL>` and `<ISSUE_URL>`. For round `N > 0`, also replace
`<PRIOR_BLOCKING_SET>` and `<DIFF_SINCE_LAST_REVIEWED_SHA>`.

---

Review `<PR_URL>` against `<ISSUE_URL>` using the procedure below. This prompt and
`references/verdict-contract.md` are authoritative; do not depend on external
`requesting-code-review` or `receiving-code-review` skills. Validate each finding
against the live diff/code and binding issue, then classify it with the contract
dispositions.

If this is round `N > 0`, provide these labeled inputs to the reviewer:

### Prior blocking set
<PRIOR_BLOCKING_SET>

### Diff since last reviewed SHA
<DIFF_SINCE_LAST_REVIEWED_SHA>

Do this:

1. Resolve the PR's current head SHA. Every verdict you post is tied to this SHA.
2. Get the actual changed-file list from the PR (the GitHub connector's file list,
   NOT the PR body's prose list — the body is often stale after rebase).
3. If this is round `0`, run a full review with two independent axes —
   Standards and Spec — preserving each axis's own order, without reranking or
   merging findings across axes. Within those axes, cover severity-tagged
   findings, a security pass where the diff touches
   auth/input/endpoints/secrets/crypto/infra, spec alignment against the
   issue's acceptance criteria, and coverage gaps.
4. If this is round `N > 0`, treat the labeled prior blocking set and labeled
   diff as the primary review material. You may consult the full tree only to
   verify a finding derived from those labeled inputs, never to discover a new
   finding outside them. Within that constraint, review regressions introduced
   by the labeled diff and anything in the binding contract that the labeled
   diff newly violates.
5. If this is round `N > 0`, compare the current evidence bundle against the
   prior round's evidence bundle. For any claim of added or changed coverage,
   require new or modified test node IDs in the diff since the previously
   reviewed SHA, and verify those exact IDs are present in runner-generated
   output showing they passed at the current head. A changed test ID with a
   green current-head result is consistent even when the aggregate test count is
   unchanged, including when an invalid test was replaced. If a coverage claim
   lacks matching changed test IDs or current-head green runner output, emit it
   as a `fix-now` finding under `needs-fix`, not `blocked`. Reserve `blocked`
   for missing or incomplete current-head CI/readiness evidence needed to
   determine the check-run gate.
6. Classify findings only with the contract dispositions: `fix-now`,
   `follow-up-issue`, `defer`, `reject`, `needs-human`.
7. Post the result as a PR comment in the exact format below. Do not attempt a
   formal REQUEST_CHANGES review — GitHub blocks that on self-authored PRs; the
   verdict lives in the comment body.

Comment format (post verbatim, filling in):

```
## review-gate: <merge-candidate | needs-fix | needs-human | blocked>

head-sha: <full 40-char SHA you reviewed>
review-round: <0-based integer>
reviewed-files: <n>
blocking-set: <comma-separated targets; repo-relative paths for code/docs, literal PR body for PR metadata; every fix-now finding for blocked or needs-fix, otherwise empty>
next-action: <one command or invocation matching the verdict state>
rebaseline: <yes on the fresh round-0 rebaseline; omit otherwise>

### Standards
- [<severity>] [<disposition>] <file/area> — <finding>

### Spec
- [<severity>] [<disposition>] <file/area> — <finding>

### Merge preconditions
- head is still <SHA>
- <any check/deploy conditions>

### Post-merge
- confirm Closes #<n> closed the issue
- next eligible ready-for-agent issue
```

Rules:
- The `head-sha`, `review-round`, `reviewed-files`, `blocking-set`, and
  `next-action` lines are mandatory. Emit them exactly in that parser shape.
- Emit `blocking-set:` on every verdict. For `blocked` or `needs-fix`, list every `fix-now` target, preserving all code findings as repo-relative paths and representing PR-body contract violations as the literal `PR body`. It is empty only when there are no `fix-now` findings.
- Emit `rebaseline: yes` only on the fresh round-0 verdict after a late-created
  or materially amended binding issue. Omit it otherwise.
- Emit `next-action:` on every verdict using exactly one of these state templates,
  substituting the resolved PR number, URL, reviewed SHA, or specific blocker:
  - `needs-fix`: `next-action: from-pr-review <PR_URL>` (start a new fixer
    session for this round, not the session that implemented the PR).
  - `merge-candidate`: `next-action: gh pr merge N --squash --match-head-commit <sha>`
    (a human runs this after rechecking current-head checks and authority). For a
    draft PR, use `next-action: gh pr ready N`; changing draft status alone does
    not require another verdict at the same SHA.
  - `blocked`: use `next-action: gh pr checks N` when waiting for current-head
    checks; for another blocker, use one exact command
    that obtains the missing evidence or repairs the blocker, not a merge or fix
    invocation.
  - `needs-human`: `next-action: gh pr view N --web` for a human to inspect
    and decide the named policy, scope, or circuit-breaker question; never
    launch an automated fix pass.
- Derive `review-round` as the number of prior conforming verdict comments for
  the current spec baseline. For historical comments emitted before this
  `next-action:` requirement, count a trusted comment with the marker and the
  previously required `head-sha:`, `review-round:`, `reviewed-files:`, and
  `blocking-set:` fields even without `next-action:`. For newer comments,
  require all five fields, including `next-action:`. Never reset a round merely
  because an earlier valid verdict predates this field. A rebaseline resets
  the count, and the first review after that emits `review-round: 0` and
  `rebaseline: yes`.
- Comments not conforming to the schema in effect when emitted are not verdicts
  and do not increment the round. Review responses, disposition comments, and
  any other PR comment do not increment the round.
- If the count cannot be determined, emit `blocked` rather than guessing.
- If you can't post the comment (connector read-only), output the block and stop —
  do not claim it posted.
- Apply the contract rules at emission time without extending or reinterpreting
  them:
  - at round `N > 0`, the labeled prior blocking set and labeled diff are the
    primary review material
  - at round `N > 0`, full-tree access is verify-only for findings derived from
    those labeled inputs; do not use the full tree to discover new findings
  - if the binding issue was created or materially amended after a prior
    verdict, rebaseline and emit round `0` with the complete current blocking
    set in one verdict comment, plus `rebaseline: yes`
  - only five dispositions exist: `fix-now`, `follow-up-issue`, `defer`,
    `reject`, `needs-human`
  - `scope-creep` must not appear
  - binding scope is the issue body plus brief clarifications explicitly marked as
    derived from it
  - unmarked brief additions are reportable, never blocking
  - if the issue body and the brief genuinely contradict each other, emit
    `needs-human` for contract reconciliation
  - round `N > 0` unchanged-since-round-0 findings become `follow-up-issue`
    unless they are correctness or security regressions
  - an unmet acceptance criterion of the binding issue is `fix-now` at any
    round while the PR still closes that issue, unless the agent cannot carry
    out its remediation in this repository with available tools and capabilities;
    in that agent-unremediable case use `needs-human`, even for an unmet
    acceptance criterion, not `fix-now` or `follow-up-issue`. Examples include
    evidence that cannot be uploaded through the available GitHub interface,
    physical-device or manual interactive verification, or a check the repo has
    no capable CI to run. Do not use this exception for work that is merely
    difficult or has not been attempted. Include a manual-verification checklist
    stating what to check, where (for example the PR deploy preview URL), and the
    expected result; if the location is unavailable, state who must provide it
    and what to check once available. Otherwise `follow-up-issue` is available
    only if the closing linkage changes in the same pass so the PR no longer
    closes the issue
  - the circuit breaker counts corrective rounds, not total conforming verdicts
  - a corrective round is a review whose diff since the previously reviewed SHA
    touches at least one file named in the prior blocking set
  - a rerun on an unchanged head, or a merge/rebase whose diff touches none of
    those files, does not increment the breaker
  - after two corrective rounds, the next corrective review yields
    `needs-human`; regressions stay `fix-now` and are reported as the human's
    blocking concerns, and everything else becomes `follow-up-issue`. The
    verdict's `blocking-set` remains empty for `needs-human`.
- `merge-candidate` only if zero `fix-now` findings remain and the target branch's
  required status-check configuration satisfies one of these paths:
  Determine required checks from getBranch and rulesets. `getBranch protected: false` establishes there are no classic required checks; do not require `/protection`, and a 403 from that subresource is not a readiness blocker with `protected: false`. Otherwise use getBranch's classic protection.required_status_checks. Try `rules/branches/{branch}` first. If that call is rejected by the calling surface before reaching GitHub (including HTTP 400/unsupported endpoint), fall through to `rulesets`. The exact body message `Upgrade to GitHub Pro or make this repository public to enable this feature.` on HTTP 403 from either call establishes rulesets are unavailable; with no classic required checks, use the no-required-check path and record `plan-unavailable`, naming which call supplied that evidence next to the readiness evidence path. Captured responses: 2026-10-08 rules-for-branch, HTTP 403, `{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.","documentation_url":"https://docs.github.com/rest/repos/rules#get-rules-for-a-branch","status":"403"}`; 2026-10-10 get-all-repository-rulesets on a private repo under GitHub Free, HTTP 403, `{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.","documentation_url":"https://docs.github.com/rest/repos/rules#get-all-repository-rulesets","status":"403"}`. Do not invent response bodies. Any other status/message, or both calls unreachable, is a readiness blocker named `rules-unverifiable`; record `indeterminate`, name each call and its status (including 400), and retain every fix-now file in blocking-set. A failure never clears code findings.
  - configured path: all applicable required checks are green at the current
    head, and at least one applicable required check exercises the changed paths
  - no-required-check path: at least one green CI/check run on the current head
    exercises the changed paths. This applies when `protected: false` and exact plan-unavailable evidence is obtained from either rules endpoint.
- If repo CI/check configuration is known and no configured CI/check can
  exercise the changed paths, an otherwise-clean review emits a `needs-human`
  finding, not `blocked`, for either readiness path. Include a manual-verification
  checklist with what to check, where (for example the PR deploy preview URL),
  and the expected result.
- If a configured check can exercise the changed paths but is pending, failing,
  or missing at the current head, emit `blocked`. If readiness configuration or
  current-head evidence cannot be established, emit `blocked` rather than
  assuming no capable check exists. Older-head results never satisfy readiness.
- Draft status is informational and does not change readiness or review
  requirements. A clean draft that satisfies readiness is `merge-candidate`; use
  `gh pr ready N` as its next action. Changing draft status alone does not require
  another verdict at the same SHA.
- Older-head results never count.
- Apply the first matching verdict rule in this order: review cannot be completed
  → `blocked`; explicit `needs-human` finding or circuit breaker → `needs-human`;
  any `fix-now` finding → `needs-fix`; otherwise clean `Door: one-way` →
  `needs-human`; clean with readiness satisfied → `merge-candidate`; otherwise
  `blocked`. Agent-unremediable acceptance-criterion findings are explicitly
  `needs-human`; a no-capable-check readiness gap becomes a `needs-human` finding
  only when the review is otherwise clean. These are existing `needs-human`
  findings, so the precedence stays exhaustive and produces exactly one state.
  A one-way designation alone does not prevent fixing ordinary findings; escalate
  once they are cleared. Explicit human-only findings and the circuit breaker
  take precedence over `fix-now`.
- The Evidence section is only a pointer to verify, never evidence itself.
- Use `skills/from-issue/references/pr-body-contract.md` for the PR body contract.
  Judge whether the Docs line adequately lists updated documentation or explains
  why none was needed. If a PR changes behavior and the Docs line is missing or
  unjustified, emit a `fix-now` finding.
- Branch protection is not required.
- Merge remains HITL.
