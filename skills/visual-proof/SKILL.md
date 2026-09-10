---
name: visual-proof
description: >
  Producer-side evidence step for visually inspectable PR work. After the final
  implementation push, render the actual level implemented, attach minimal
  GitHub-hosted visual evidence to the PR, and stamp it to the exact head SHA;
  or explain why visual proof is genuinely not applicable. This is not a review
  gate and cannot grant its own N/A exemption.
---

# visual-proof

`visual-proof` runs in the implementation lane after code/test verification and
after the final implementation push, but before handoff to the fresh
`review-gate` session. It produces evidence; it does not review the work, change
workflow state, or authorize merge.

## Inputs

- The implementation PR URL/number and governing issue.
- The current repository checkout/worktree when local rendering is needed.
- Existing app/component preview surfaces and browser/runtime tooling already
  available to the repository.

## Producer states

The durable producer comment uses exactly one of these states:

- `provided` — current-head visual evidence is attached.
- `n/a` — visual proof is genuinely not applicable or cannot reasonably be
  produced at this implementation stage without out-of-scope integration.

These are producer claims only. `review-gate` independently classifies the
current-head evidence as `PROVIDED`, `N/A`, or `MISSING`; a producer `n/a` does
not grant an exemption.

## Steps

1. Resolve the PR's current head SHA from GitHub. Do not take it from PR prose.
2. Read the governing issue, actual changed-file list, and implemented scope.
3. Decide whether the work is meaningfully visually inspectable and, if so,
   whether it can reasonably be rendered at the level actually implemented.
4. If the work is not visually inspectable, or rendering would require
   out-of-scope integration, prepare a conforming `n/a` comment with the exact
   current head SHA and a concrete reason. Do not manufacture a screenshot.
5. If it is renderable, use the narrowest existing surface that proves the
   implemented claim: integrated route, Storybook/component preview, dev
   fixture, test harness, or another existing/trivial local render surface.
6. Exercise the affected state. Capture the minimum useful evidence:
   - screenshot for a static state;
   - before/after for a visual bug fix when practical;
   - only materially affected viewports for responsive work;
   - short video for interaction/animation when a still image cannot prove it.
7. Keep scope fidelity explicit. A standalone component render proves the
   standalone component, not production integration. Do not add fake production
   routes, unrelated wiring, or a general preview system merely to obtain proof.
8. Re-resolve the PR head immediately before posting. If it changed after the
   capture, stop and regenerate/reclassify against the new head.
9. Post the durable PR comment using the contract in
   `references/comment-contract.md`. For media, prefer GitHub CLI v2.99+:
   `gh pr comment <PR> --body-file <file> --attach '<path>#<alt text>'`.
   Repeat `--attach` only when multiple artifacts are materially necessary.
10. Read the posted comment back from GitHub and verify the marker, full head
    SHA, surface/claim, and GitHub-hosted attachment (for `provided`) are present.
11. Hand the PR to `review-gate`. Any later push makes this proof stale and
    requires `visual-proof` to run again before the next merge-candidate review.

## Tooling failures

Failure to capture or upload proof is not `n/a` when the work is otherwise
reasonably renderable. Do not external-host the media or commit transient proof
artifacts to the repository as a workaround. Persist the exact tooling blocker
on the PR/issue and leave the reviewer to classify the missing evidence.

## Do not

- Do not run a second review or emit a `review-gate` verdict.
- Do not treat screenshots as visual-regression tests.
- Do not require screenshots for backend/CLI/internal-only work.
- Do not accept a stale proof comment after the PR head changes.
- Do not overclaim integration, viewport coverage, or interaction behavior that
  the attached evidence does not demonstrate.
- Do not commit transient screenshots/videos to the repository.
- Do not use an external screenshot-hosting service when GitHub-hosted media is
  available.
