# Five-minute walkthrough: issue #242 to merged PR #271

This walkthrough follows one real Tracer change from its GitHub contract through implementation, review, checks, and a human-owned merge. It uses the repository's historical artifacts, not a demo environment.

## 1. Start with the issue contract

[Issue #242](https://github.com/ptstory/tracer-workflow/issues/242) asked to align the workflow documentation with the runtime that was actually in use. Its scope and acceptance criteria named the README, workflow/runtime references, and architecture sources. It was marked HITL: an agent could prepare and verify the change, but the human retained merge authority.

The issue contained the scope and acceptance criteria. It also recorded the scope amendment that later authorized a narrow contract test for the HITL/AFK statements in `WORKFLOW.md` and `CONTEXT.md` ([amendment](https://github.com/ptstory/tracer-workflow/issues/242#issuecomment-6963286716)).

## 2. Follow the work on the PR

[PR #271](https://github.com/ptstory/tracer-workflow/pull/271) implemented the documentation truth-up and eventually added the owner-authorized policy test. Its body records the exact local verification commands, results, and tested node IDs against head `3470484c243f5d51d7a8c39b864be1bb9ae5a307`; its current-head CI run is [#44203131054](https://github.com/ptstory/tracer-workflow/actions/runs/44203131054). The run completed successfully with seven jobs, including tests, typecheck, PR-body validation, Review Gate contract, RADAR, OpenAPI importer, and public-disclosure checks.

## 3. See the work change after review feedback

The first Review Gate verdict was `needs-fix` on head `575214366f7493addf0f706190f7d397d41a2c81`: the README did not clearly identify `skills/review-gate/` as the canonical contract ([round 0](https://github.com/ptstory/tracer-workflow/pull/271#issuecomment-6961893556)). The correction was commit [`8391e67`](https://github.com/ptstory/tracer-workflow/commit/8391e677e3fc891dff3cb3eb5e5508a6415ac1ca).

The next review did not treat green CI as proof of the edited policy. It returned `needs-human`: the changed `WORKFLOW.md` and `CONTEXT.md` paths were outside the docs-only allowlist, and no required check then demonstrated coverage of those policy changes ([round 1](https://github.com/ptstory/tracer-workflow/pull/271#issuecomment-6962112451)). After the issue owner amended the scope, commit [`3470484`](https://github.com/ptstory/tracer-workflow/commit/3470484c243f5d51d7a8c39b864be1bb9ae5a307) added the focused test. The fresh review re-baselined at that SHA and found a PR-body documentation mismatch, not another source-code issue ([re-baselined review](https://github.com/ptstory/tracer-workflow/pull/271#issuecomment-6963664774)). The PR description was corrected, and the final verdict was `merge-candidate` for the same head ([final verdict](https://github.com/ptstory/tracer-workflow/pull/271#issuecomment-6964767500)).

## 4. What the checks and verdict establish

The required CI jobs and the public-disclosure job passed on the exact `3470484…` head, as recorded in [run #44203131054](https://github.com/ptstory/tracer-workflow/actions/runs/44203131054). The Review Gate comment also names that head. The verdict reader accepts only marker-form comments by configured reviewer logins and validates required fields; readiness compares the verdict SHA with the live PR head. A new push makes the old verdict stale. See the [verdict parser](https://github.com/ptstory/tracer-workflow/blob/main/tooling/lib/verdict.ts#L19-L33), [head comparison](https://github.com/ptstory/tracer-workflow/blob/main/tooling/gate-state/gate-state.ts#L74-L99), and [readiness evaluation](https://github.com/ptstory/tracer-workflow/blob/main/.github/workflows/gate-readiness.yml#L215-L305).

These checks establish that configured checks and the accepted review state met the repository's readiness rules at that SHA. They do not prove the documentation is correct by themselves, nor does `merge-candidate` itself grant merge permission. The comment-only verdict and its SHA-staleness rule are defined in the [Review Gate contract](https://github.com/ptstory/tracer-workflow/blob/main/skills/review-gate/references/verdict-contract.md#L46-L85).

## 5. Readiness and merge authority

The final verdict's next action was to mark the PR ready. An automated attempt failed to change its draft state and recorded that failure ([stop record](https://github.com/ptstory/tracer-workflow/pull/271#issuecomment-6964773535)); this was not an issue-autonomy check. The owner later marked the PR ready and merged it on 2026-11-18; GitHub records merge commit [`f8455b5`](https://github.com/ptstory/tracer-workflow/commit/f8455b5e2dce7a821245dc2837cc731f871f52d6), and the closing reference closed issue #242.

Tracer's contract says HITL by default and requires explicit issue authorization for AFK ([HITL/AFK rule](../WORKFLOW.md#hitl--afk)). After the 2026-11-20 merge of [PR #279](https://github.com/ptstory/tracer-workflow/pull/279), the auto-merge workflow identifies the linked closing issue, requires exactly one in-repository issue, and checks that it is open and explicitly authorizes AFK before marking the PR ready or merging ([issue authorization check](https://github.com/ptstory/tracer-workflow/blob/65fc79249cc4727806bed5cd201fafbd93e7e595/.github/workflows/review-gate-auto-merge.yml#L170-L258), [readiness and merge guards](https://github.com/ptstory/tracer-workflow/blob/65fc79249cc4727806bed5cd201fafbd93e7e595/.github/workflows/review-gate-auto-merge.yml#L300-L386)). It also retains the trusted current-head verdict, current-head required checks, and exact-head merge guard. PR #279 added the authorization gate after the historical PR #271 run; it did not govern that earlier run.

## What this example does not claim

- A trusted, correctly formatted verdict establishes the comment's provenance and SHA binding; it does not validate every reviewer judgment.
- Green checks establish only what those checks actually run. The `needs-human` round exposed a real coverage gap; the issue was amended and a focused test added rather than claiming general policy coverage.
- A stale head, a missing or failing check, missing configuration, or unavailable merge prerequisites can block readiness. The separate auto-merge workflow also requires the linked issue's explicit AFK authorization and current-head checks.
- This is one historical example. It demonstrates the recorded workflow and its limitations, not a performance benchmark or proof that every issue follows the same path.
