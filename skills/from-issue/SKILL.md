---
name: from-issue
description: >
  Execution stage for a ready-for-agent issue: consume the validated execution
  input plus the current worktree state, implement the smallest safe slice, and
  stop at PR + evidence bundle or one of the explicitly allowed blocker/failure
  outcomes. Downstream review, check-run, and merge stay in subordinate lanes.
  Never mint a second implementation handoff for the same issue.
---

# from-issue

`from-issue` is the execution stage, not triage. It consumes one validated,
action-ready input and the current worktree state, then either finishes the
slice or stops on a genuine blocker. Chat memory is not required; the validated
artifact is the execution input.

Session and continuation behavior follows [`CONTINUATION.md`](../../CONTINUATION.md).
The normal entry for a new issue is a fresh OpenCode implementation session. Once
that lane exists, keeping it through review-fix cycles is preferred for efficiency
but never required for correctness.

## Inputs

- A GitHub issue URL or number plus its durable `ready-for-agent` brief.
- A validated complete pasted implementation handoff for that issue.
- A validated pasted durable agent brief.
- Validate a pasted handoff by matching a bounded shape such as `Issue #N
  handoff` plus explicit `Goal`, `Files`, `Constraints`, `Acceptance
  criteria`, and `Verification` sections (or an equivalent durable brief with
  the same responsibilities); otherwise treat it as an incomplete contract and
  stop only as an explicit blocker.
- A local repo checkout or worktree that belongs to the issue.

## Dirty checkout

- If the primary checkout is dirty and isolation is required, create or reuse
  the dedicated issue branch/worktree and continue execution there.
- If the dirty state belongs to the current issue and is safe, continue in
  place.
- If the dirty state is unrelated or unsafe, stop and emit a blocker handoff
  only.

## Contract

- Resume the existing issue/worktree if it already exists.
- Treat a validated issue brief, pasted implementation handoff, or pasted
  durable agent brief as valid execution input; do not require chat memory.
- Once action-ready input is accepted, any nested `using-superpowers`,
  brainstorming, or planning step is a subordinate subroutine and must return
  control to execution.
- An ordinary `Approve this direction` / design-approval checkpoint does not
  end the run unless it explicitly names a concrete unresolved blocker that is
  absent from the issue or brief.
- Multi-file scope, UI impact, a desire for planning, or a nested skill's
  default approval checkpoint are not blockers by themselves.
- A handoff-only result is allowed only for genuine blockers or verified failures that cannot be recovered in the current worktree.
- Do not emit another implementation handoff for the same issue; update or
  resume the existing lane instead.
- The terminal completion result is one of four outcomes:
  - PR opened with a closing issue reference plus an evidence bundle.
  - Existing PR/worktree resumed and advanced.
  - Explicit durable blocker naming the exact missing prerequisite or decision.
  - Verified failure with the exact recovery state persisted.
- Treat `review-gate`, `from-pr-review`, and `receiving-code-review` as
  subordinate judgment/review lanes; do not flatten them into `from-issue`.

## Continuation pointer

Use the canonical `<!-- tracer-continuation:v1 -->` contract in
[`CONTINUATION.md`](../../CONTINUATION.md).

- When implementation starts, update the issue's existing pointer when possible
  with `stage: implementation`, `surface: OpenCode`, and a safe
  `implementation-locator` if one is available. Never publish private/signed
  session URLs or unsafe local paths merely to preserve continuity.
- Once a PR exists, the PR becomes the active artifact. Create or update its
  single marked continuation comment rather than appending competing pointers.
- The immediate post-implementation transition is a **fresh** independent
  `review-gate` for the current PR head, so use `session-policy: fresh-required`
  and bind `head-sha` to that full current head SHA.
- Preserve a safe `implementation-locator` in the PR pointer when available so
  a later current-head `needs-fix` verdict can preferentially return to this
  implementation lane.
- The fallback is always a fresh implementation context reconstructed from the
  issue/PR, branch/worktree, verdicts, and current GitHub state.

## Steps

1. Load the issue and any existing branch/worktree for that issue.
2. Validate the input artifact if it was pasted, then resume the same
   issue/worktree when present; do not recreate the handoff or branch.
3. Inspect checkout/worktree cleanliness and classify any dirtiness explicitly.
4. If the primary checkout is dirty and isolation is required, create or reuse
   the dedicated issue branch/worktree and continue execution there.
5. Refresh the issue continuation pointer for the active implementation lane when
   a safe locator is available.
6. Implement the smallest safe slice.
7. Verify locally.
8. Commit, push, open or update the PR, and include the evidence bundle.
9. Resolve the new full PR head SHA and create/update the PR continuation pointer
   for a fresh `review-gate`, retaining the safe implementation locator when
   available. Stop there; review, check-run, and merge remain downstream.
10. If blocked or a verified failure cannot be recovered locally, first persist
    the exact blocker or recovery state durably in the linked GitHub issue or PR
    comment, refresh the continuation pointer to the single recovery action when
    possible, then stop with a blocker handoff that names the blocker, the
    failure, and the next required recovery contract.

## Do not

- Do not triage the issue again.
- Do not emit a second implementation handoff for the same issue.
- Do not silently discard dirty worktree state.
- Do not claim progress when a genuine blocker prevents execution.
- Do not make a session locator authoritative over current GitHub or checkout
  state.
