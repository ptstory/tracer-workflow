# review-gate prompt

Paste into a **fresh** ChatGPT/Claude web session (GitHub connector required, with
comment-write access). Fresh session is deliberate — it reviews the PR against the
issue as written, carrying none of the planning thread's assumptions. Replace
`<PR_URL>` and `<ISSUE_URL>`. For round `N > 0`, also replace
`<PRIOR_BLOCKING_SET>` and `<DIFF_SINCE_LAST_REVIEWED_SHA>`.

---

Review `<PR_URL>` against `<ISSUE_URL>` using the superpowers `requesting-code-review`
skill (producer) and classify each finding with `receiving-code-review` dispositions.

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
5. Compare the current evidence bundle against the prior round's evidence
   bundle. If the test count is unchanged while the new bundle claims added
   coverage, emit `blocked` and name the evidence inconsistency.
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
blocking-set: <comma-separated repo-relative file paths; empty unless needs-fix>
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
- The `head-sha`, `review-round`, `reviewed-files`, and `blocking-set` lines are
  mandatory. Emit them exactly in that parser shape.
- Emit `blocking-set:` on every verdict. It is empty unless the verdict is
  `needs-fix`, in which case it lists the repo-relative file paths named by the
  round's blocking findings.
- Emit `rebaseline: yes` only on the fresh round-0 verdict after a late-created
  or materially amended binding issue. Omit it otherwise.
- Derive `review-round` as the number of prior conforming verdict comments for
  the current spec baseline — comments carrying the marker and all required
  fields. A rebaseline resets the count, and the first review after that emits
  `review-round: 0` and `rebaseline: yes`.
- Non-conforming comments are not verdicts and do not increment the round.
  Review responses, disposition comments, and any other PR comment do not
  increment the round.
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
  - an unmet acceptance criterion of the binding issue stays `fix-now` at any
    round while the PR still closes that issue; `follow-up-issue` is available
    only if the closing linkage changes in the same pass
  - the circuit breaker counts corrective rounds, not total conforming verdicts
  - a corrective round is a review whose diff since the previously reviewed SHA
    touches at least one file named in the prior blocking set
  - a rerun on an unchanged head, or a merge/rebase whose diff touches none of
    those files, does not increment the breaker
  - after two corrective rounds, the next corrective review yields
    `needs-human`; regressions stay `fix-now` and are named as the human's
    blocking set, and everything else becomes `follow-up-issue`
- `merge-candidate` only if zero `fix-now` findings remain and at least one
  green required check exercises the changed paths.
- If no green required check exercises the changed paths, emit `blocked` and
  name the coverage gap rather than green.
