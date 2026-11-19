# Differential Security Review: PR #279

## Executive Summary

| Severity | Findings |
|---|---:|
| Critical | 0 |
| High | 0 unresolved after the corrective patch |
| Medium | 0 |
| Low | 0 |

**Overall risk:** High-risk authorization boundary, with the reviewed round-1 false-positive paths addressed in the working diff and covered by regression tests.

**Recommendation:** Conditional on passing final CI and a fresh trusted Review Gate verdict for the new head. This report is from the PR fix pass, not an independent approval or merge authorization.

## What Changed

**Base:** `origin/main` (`eb97848`)

**Current reviewed working changes:** `.github/workflows/review-gate-auto-merge.yml`, `tooling/review-gate-auto-merge/README.md`, and `tooling/review-gate-auto-merge/review-gate-auto-merge.behavior.test.ts`.

The workflow's issue autonomy parser now ignores fenced Markdown examples and blockquotes when collecting the canonical declaration, while rejecting explicit no-auto-merge and human-only policy language. The behavior suite includes fenced/quoted declaration and conflicting merge-policy cases, asserting no ready or merge calls.

## Round-1 Finding and Disposition

- **[High] Authorization false positives:** `fix-now`. An `Autonomy: AFK-safe` literal in a fenced example or alongside an explicit prohibition on auto-merge could previously pass the workflow's finite conflict detector. The current changes exclude fenced/quoted declarations and detect the reviewer-cited prohibition plus common human-only merge variants. Added regressions cover a fenced example, blockquote example, `Do not auto-merge this PR`, `Auto-merge is not authorized`, and `Auto-merge is prohibited`; each runs through the behavior harness's zero-ready/zero-merge assertions.

## Security Analysis

- The authorization check remains before ready and merge mutations, and is repeated before merge.
- The issue API and linkage failure paths remain fail-closed; existing exact-head, trusted-verdict, required-check, blocking-label, and token checks are unchanged by this corrective patch.
- Canonical authorization remains the unique exact `Autonomy: AFK-safe` format used by the Herdr watcher. Fenced examples and quoted lines do not authorize.
- The conflict detector is deliberately finite; this patch closes the concrete reviewer reproductions and common explicit restriction forms, but cannot establish semantic understanding of arbitrary natural-language policy. Exact canonical positive authorization and issue HITL markers provide the primary guard; unusual contradictory wording remains a residual limitation that merits future structured-policy consideration.

## Test Coverage

- Focused behavior suite: 66 tests, 0 failures.
- Full suite: 373 tests across 25 files, 0 failures, after the final parser change.
- TypeScript check: `bun run typecheck` passed after the final parser change.
- `git diff --check`: passed after the final parser change.

The regression cases exercise the modified path through the workflow harness and assert zero `gh pr ready` and `gh pr merge` calls for rejected policies.

## Historical Context and Blast Radius

- The authorization path was introduced in `84c36cf` and corrected in `001eb3d`; the latest review identified a parser false-positive at the workflow authorization boundary.
- No removed security validation was found in the round-2 diff. The patch tightens issue-policy interpretation without changing merge token, check-run, trusted-verdict, or exact-head guard logic.
- Blast radius is limited to the single auto-merge workflow's issue-authorization gate and its behavior tests/documentation.

## Limitations and Gate

- GitHub checks observed before the new commit apply to the old head only and do not establish readiness for this corrective patch.
- The PR is bound to issue #278 titled `[HITL]`; a human retains merge authority regardless of green checks or local evidence.
- A fresh trusted Review Gate verdict must review the pushed head before any readiness claim. This report is not a verdict.
