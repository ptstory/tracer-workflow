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

## Inputs

- A GitHub issue URL or number plus its durable `ready-for-agent` brief.
- A validated complete pasted implementation handoff for that issue.
- A validated pasted durable agent brief.
- A local repo checkout or worktree that belongs to the issue.

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
- Treat dirty checkout/worktree state explicitly: say what is dirty and whether
  it is current-issue work, leftover in-flight work, or unrelated drift.
- If the dirty state belongs to the current issue and is safe, continue in
  place.
- If the dirty state is unrelated or unsafe, stop and emit a blocker handoff only.
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

## Steps

1. Load the issue and any existing branch/worktree for that issue.
2. Validate the input artifact if it was pasted, then resume the same
   issue/worktree when present; do not recreate the handoff or branch.
3. Inspect checkout/worktree cleanliness and classify any dirtiness explicitly.
4. Implement the smallest safe slice.
5. Verify locally.
6. Commit, push, open or update the PR, and include the evidence bundle. Stop
   there; review, check-run, and merge remain downstream.
7. If blocked or a verified failure cannot be recovered locally, stop with a blocker handoff that names the blocker, the failure, and the next required recovery contract.

## Do not

- Do not triage the issue again.
- Do not emit a second implementation handoff for the same issue.
- Do not silently discard dirty worktree state.
- Do not claim progress when a genuine blocker prevents execution.
