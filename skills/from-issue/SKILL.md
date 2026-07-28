---
name: from-issue
description: >
  Execution stage for a ready-for-agent issue: resume or create the issue
  worktree, implement the smallest safe slice, and emit only a blocker handoff
  when a genuine blocker prevents progress. Never mint a second implementation
  handoff for the same issue.
---

# from-issue

`from-issue` is the execution stage, not triage. It consumes one durable
`ready-for-agent` issue and the current worktree state, then either finishes the
slice or stops on a genuine blocker.

## Inputs

- One issue URL or number.
- The issue is already labeled `ready-for-agent`.
- A local repo checkout or worktree that belongs to the issue.

## Contract

- Resume the existing issue/worktree if it already exists.
- Treat dirty checkout/worktree state explicitly: say what is dirty and whether
  it is current-issue work, leftover in-flight work, or unrelated drift.
- If the dirty state belongs to the current issue and is safe, continue in
  place.
- If the dirty state is unrelated or unsafe, stop and emit a blocker handoff only.
- A handoff-only result is allowed only for genuine blockers.
- Do not emit another implementation handoff for the same issue; update or
  resume the existing lane instead.
- The completion result is a PR with a closing issue reference plus an evidence
  bundle.

## Steps

1. Load the issue and any existing branch/worktree for that issue.
2. If the same issue/worktree exists, resume it; do not recreate the handoff or
   branch.
3. Inspect checkout/worktree cleanliness and classify any dirtiness explicitly.
4. Implement the smallest safe slice.
5. Verify locally.
6. Commit, push, open or update the PR, and include the evidence bundle.
7. If blocked, stop with a blocker handoff that names the blocker and the next
   required contract.

## Do not

- Do not triage the issue again.
- Do not emit a second implementation handoff for the same issue.
- Do not silently discard dirty worktree state.
- Do not claim progress when a genuine blocker prevents execution.
