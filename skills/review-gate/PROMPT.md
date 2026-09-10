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
3. Inspect any conforming `## visual-proof: provided` / `## visual-proof: n/a`
   producer comments and classify visual proof for the current head as `PROVIDED`, `N/A`, or `MISSING`:
   - `PROVIDED` only when a current-head `provided` comment carries usable media,
     the evidence is sufficient for the implemented issue scope, and it does not
     overclaim integration or behavior beyond what the media demonstrates;
   - `N/A` when the work is genuinely non-visual or cannot reasonably be rendered
     at this implementation stage without out-of-scope integration;
   - `MISSING` when visually inspectable work is reasonably renderable but proof
     is absent, stale, materially insufficient, scope-overclaiming, or justified
     only by an invalid producer `n/a`.
   Do not accept a producer `n/a` as authority. A stale proof comment never counts for the current head. A producer comment's existence is not enough: inspect the attached media when `provided` is claimed. Visual-proof classification is current-head evidence, not permission to discover new code findings outside the round rules below.
4. If this is round `0`, run a full review with two independent axes —
   Standards and Spec — preserving each axis's own order, without reranking or
   merging findings across axes. Within those axes, cover severity-tagged
   findings, a security pass where the diff touches
   auth/input/endpoints/secrets/crypto/infra, spec alignment against the
   issue's acceptance criteria, and coverage gaps.
5. If this is round `N > 0`, treat the labeled prior blocking set and labeled
   diff as the primary review material. You may consult the full tree only to
   verify a finding derived from those labeled inputs, never to discover a new
   finding outside them. Within that constraint, review regressions introduced
   by the labeled diff and anything in the binding contract that the labeled
   diff newly violates. Re-evaluate current-head visual proof as evidence on every
   round; doing so does not create a new code-finding discovery lane.
6. If this is round `N > 0`, compare the current evidence bundle against the
   prior round's evidence bundle. If the test count is unchanged while the new
   bundle claims added coverage, emit `blocked` and name the evidence
   inconsistency.
7. Classify findings only with the contract dispositions: `fix-now`,
   `follow-up-issue`, `defer`, `reject`, `needs-human`.
8. Post the result as a PR comment in the exact format below. Do not attempt a
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

### Visual proof
- status: <PROVIDED | N/A | MISSING>
- <current-head evidence or concise rationale>

### Merge preconditions
- head is still <SHA>
- <any check/deploy/evidence conditions>

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
- Always emit the `### Visual proof` section with exactly one status:
  `PROVIDED`, `N/A`, or `MISSING`.
- `MISSING` visual proof is an evidence gap, not a repo-relative code finding.
  If it is the only merge blocker, emit `blocked` and leave `blocking-set:` empty.
  If independent `fix-now` findings already require `needs-fix`, keep
  `needs-fix`, list only their repo-relative files in `blocking-set`, and record
  the visual-proof gap as a merge precondition.
- `PROVIDED` and `N/A` do not override Standards/Spec findings or check-run
  readiness. Non-visual backend/CLI/internal work does not acquire a screenshot
  requirement.
- Emit `rebaseline: yes` only on the fresh round-0 verdict after a late-created
  or materially amended binding issue. Omit it otherwise.
- Derive `review-round` as the number of prior conforming verdict comments for
  the current spec baseline — comments carrying the marker and all required
  fields. A rebaseline resets the count, and the first review after that emits
  `review-round: 0` and `rebaseline: yes`.
- Non-conforming comments are not verdicts and do not increment the round.
  Review responses, disposition comments, visual-proof producer comments, and
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
  - current-head visual-proof evidence may be re-evaluated on every round without
    creating a new code-finding discovery lane
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
- `merge-candidate` only if zero `fix-now` findings remain, visual proof is not
  `MISSING`, and the target branch's required status-check configuration
  satisfies one of these paths:
  - configured path: all applicable required checks are green at the current
    head, and at least one applicable required check exercises the changed paths
  - no-required-check path: at least one green CI/check run on the current head
    exercises the changed paths
- If neither path is satisfied, visual proof is `MISSING`, or there is no
  current-head evidence, emit `blocked` rather than green unless independent
  `fix-now` findings already require `needs-fix`.
- Older-head results never count.
- Branch protection is not required.
- Merge remains HITL.
