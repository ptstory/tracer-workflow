---
name: from-issue
description: >
  Execution stage for a ready-for-agent issue: consume the validated execution
  input plus the current worktree state, implement the smallest safe slice, and
  stop at PR + evidence bundle or one of the explicitly allowed blocker/failure
  outcomes. Downstream review, check-run, and merge stay in subordinate stages.
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
- For GitHub issues, load the body and comments with `gh issue view <n> --comments`.
  Treat an `## Agent Brief` comment as the durable brief when present, and apply
  later owner decision comments to it. The issue body may itself serve as the
  brief when it contains the complete execution contract; do not block for a
  missing `Agent Brief` heading.
- A reference to another open or HITL issue is not a blocker when the brief
  provides a default, marks the decision out of scope, or a later owner comment
  records the decision. A genuinely missing required decision with no default
  may block execution.
- Once action-ready input is accepted, any nested `using-superpowers`,
  brainstorming, or planning step is a subordinate subroutine and must return
  control to execution.
- An ordinary `Approve this direction` / design-approval checkpoint does not
  end the run unless it explicitly names a concrete unresolved blocker that is
  absent from the issue or brief.
- Multi-file scope, UI impact, a desire for planning, or a nested skill's
  default approval checkpoint are not blockers by themselves.
- Missing dependencies, generated files, local services, or web-fetch 404s on
  private repositories are recoverable environment gaps, not blockers. Run the
  documented repository setup and repair the local environment before considering
  a blocker.
- A handoff-only result is allowed only for genuine blockers or verified failures that cannot be recovered in the current worktree.
- Do not emit another implementation handoff for the same issue; update or
  resume the existing stage instead.
- The terminal completion result is one of four outcomes:
  - PR opened with a closing issue reference plus an evidence bundle.
  - Existing PR/worktree resumed and advanced.
  - Explicit durable blocker naming the exact missing prerequisite or decision.
  - Verified failure with the exact recovery state persisted.
- Treat `review-gate` and `from-pr-review` as
  subordinate judgment/review stages; do not flatten them into `from-issue`.

## Steps

1. Load the issue and any existing branch/worktree for that issue.
2. Validate the input artifact if it was pasted, then resume the same
   issue/worktree when present; do not recreate the handoff or branch.
3. Inspect checkout/worktree cleanliness and classify any dirtiness explicitly.
4. If the primary checkout is dirty and isolation is required, create or reuse
   the dedicated issue branch/worktree and continue execution there.
5. Run repository-documented setup before implementation: dependency installation
   and any applicable local-service, migration, or browser setup documented in
   `AGENTS.md`, `README.md`, or `.agents/repo-context.md`. Repair missing local
   prerequisites rather than treating them as blockers.
6. Implement the smallest safe slice.
7. Verify locally.
8. In the PR body's Evidence section, copy the SHA from the brief's
   `written-against` line into `Brief written against`, or use `none recorded`
   if the brief has no recorded SHA. If a SHA is recorded, compare the files
   named in the brief against the live default branch since that SHA and list
   any that changed there under Evidence; do not treat this as a parser or
   automatic blocker. If none changed, state that explicitly.
9. Commit, push, open or update the PR, and include the evidence bundle. Stop
   there; review, check-run, and merge remain downstream.
   Use `references/pr-body-contract.md` when creating or updating the PR body.
10. If blocked or a verified failure cannot be recovered locally, first persist the exact blocker or recovery state durably in the linked GitHub issue or PR comment, then stop with a blocker handoff that names the blocker, the recovery attempted, why it failed, and the next required recovery contract.

## Do not

- Do not triage the issue again.
- Do not emit a second implementation handoff for the same issue.
- Do not silently discard dirty worktree state.
- Do not claim progress when a genuine blocker prevents execution.
