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
3. Run the review: severity-tagged findings, security pass where the diff touches
   auth/input/endpoints/secrets/crypto/infra, spec alignment against the issue's
   acceptance criteria, coverage gaps.
4. Classify each finding as one of: `fix-now`, `defer`, `follow-up-issue`,
   `reject` (with evidence), `needs-human`.
5. Post the result as a PR comment in the exact format below. Do not attempt a
   formal REQUEST_CHANGES review — GitHub blocks that on self-authored PRs; the
   verdict lives in the comment body.

Comment format (post verbatim, filling in):

```
## review-gate: <merge-candidate | needs-fix | needs-human | blocked>

head-sha: <full 40-char SHA you reviewed>
reviewed-files: <n>

### Findings
- [<severity>] [<disposition>] <file/area> — <finding>
- ...

### Merge preconditions
- head is still <SHA>
- <any check/deploy conditions>

### Post-merge
- confirm Closes #<n> closed the issue
- next eligible ready-for-agent issue
```

Rules:
- The `head-sha` line is mandatory. A verdict without it is void.
- If you can't post the comment (connector read-only), output the block and stop —
  do not claim it posted.
- `merge-candidate` only if zero `fix-now` findings remain.
