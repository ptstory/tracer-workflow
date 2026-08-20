# review-gate prompt

Paste into a **fresh** ChatGPT/Claude web session (GitHub connector required, with
comment-write access). Fresh session is deliberate — it reviews the PR against the
issue as written, carrying none of the planning thread's assumptions. Replace
`<PR_URL>` and `<ISSUE_URL>`.

---

Review `<PR_URL>` against `<ISSUE_URL>` using the superpowers `requesting-code-review`
skill (producer) and classify each finding with `receiving-code-review` dispositions.

Do this:

1. Resolve the PR's current head SHA. Every verdict you post is tied to this SHA.
2. Get the actual changed-file list from the PR (the GitHub connector's file list,
   NOT the PR body's prose list — the body is often stale after rebase).
3. Run the review with two independent axes — Standards and Spec — preserving
   each axis's own order, without reranking or merging findings across axes.
   Within those axes, cover severity-tagged findings, a security pass where the
   diff touches auth/input/endpoints/secrets/crypto/infra, spec alignment
   against the issue's acceptance criteria, and coverage gaps.
4. Classify findings only with the contract dispositions: `fix-now`,
   `follow-up-issue`, `defer`, `reject`, `needs-human`.
5. Post the result as a PR comment in the exact format below. Do not attempt a
   formal REQUEST_CHANGES review — GitHub blocks that on self-authored PRs; the
   verdict lives in the comment body.

Comment format (post verbatim, filling in):

```
## review-gate: <merge-candidate | needs-fix | needs-human | blocked>

head-sha: <full 40-char SHA you reviewed>
review-round: <0-based integer>
reviewed-files: <n>

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
- The `head-sha`, `review-round`, and `reviewed-files` lines are mandatory.
  Emit them exactly in that parser shape.
- Derive `review-round` as the number of prior conforming verdict comments on
  the PR — comments carrying the marker and all required fields. The first
  review emits `review-round: 0`.
- Non-conforming comments are not verdicts and do not increment the round.
  Review responses, disposition comments, and any other PR comment do not
  increment the round.
- If the count cannot be determined, emit `blocked` rather than guessing.
- If you can't post the comment (connector read-only), output the block and stop —
  do not claim it posted.
- Apply the contract rules at emission time without extending or reinterpreting
  them:
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
  - round `3` or higher yields `needs-human`; regressions stay `fix-now` and
    are named as the human's blocking set, and everything else becomes
    `follow-up-issue`
- `merge-candidate` only if zero `fix-now` findings remain.
