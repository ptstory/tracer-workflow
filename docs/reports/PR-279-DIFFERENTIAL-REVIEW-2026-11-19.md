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

**Current PR files:** `.github/workflows/review-gate-auto-merge.yml`, `tooling/review-gate-auto-merge/README.md`, `tooling/review-gate-auto-merge/review-gate-auto-merge.behavior.test.ts`, and this report.

The workflow's issue autonomy parser ignores fenced Markdown examples, blockquotes, four-space-indented code, and HTML comments when collecting the canonical declaration, while rejecting explicit no-auto-merge and human-only policy language. The behavior suite includes each syntax case and conflicting merge-policy cases, asserting no ready or merge calls.

## Round-1 Finding and Disposition (carried forward)

- **[High] Authorization false positives:** `fix-now`. The round-1 finding covered fenced/quoted declarations and conflicting human-only merge language; earlier corrective changes exclude those declaration sources and test explicit restrictions. The round-2 review identified two remaining forms, tracked separately below.

## Round-2 Finding and Disposition

- **[High] Authorization false positives in non-rendered Markdown:** `fix-now`. A four-space-indented code sample or a declaration inside an HTML comment could still be counted as the unique authorization. The workflow now excludes indented code and strips HTML comments before declaration parsing. Both reported forms have behavior regressions that assert zero ready and merge calls.

## Security Analysis

- The authorization check remains before ready and merge mutations, and is repeated before merge.
- The current diff changes only Markdown-body preprocessing and adds two negative behavior fixtures; the existing exact declaration, fenced/quoted exclusions, conflict detection, and linkage checks remain in place.
- The issue API and linkage failure paths remain fail-closed; existing exact-head, trusted-verdict, required-check, blocking-label, and token checks are unchanged by this corrective patch.
- Canonical authorization remains the unique exact `Autonomy: AFK-safe` format used by the Herdr watcher. Fenced, quoted, indented-code, and HTML-comment examples do not authorize.
- The conflict detector is deliberately finite; this patch closes the concrete reviewer reproductions and common explicit restriction forms, but cannot establish semantic understanding of arbitrary natural-language policy. Exact canonical positive authorization and issue HITL markers provide the primary guard; unusual contradictory wording remains a residual limitation that merits future structured-policy consideration.

## Test Coverage

- Focused behavior suite: 68 tests, 0 failures.
- Full suite: 375 tests across 25 files, 0 failures.
- `bun run typecheck`: passed.
- `git diff --check`: passed.

The regression cases exercise the modified path through the workflow harness and assert zero `gh pr ready` and `gh pr merge` calls for rejected policies. JUnit runner output reports the new cases as `does not ready or merge when issue authorization is indented autonomy example` and `does not ready or merge when issue authorization is HTML-comment autonomy example`.

## Historical Context and Blast Radius

- The authorization path was introduced in `84c36cf` and corrected in `001eb3d`; the latest review identified a parser false-positive at the workflow authorization boundary.
- No removed security validation was found in the round-2 diff. The patch tightens issue-policy interpretation without changing merge token, check-run, trusted-verdict, or exact-head guard logic.
- Blast radius is limited to the single auto-merge workflow's issue-authorization gate and its behavior tests/documentation.

## Limitations and Gate

- GitHub checks observed before the new commit apply to the old head only and do not establish readiness for this corrective patch.
- The PR is bound to issue #278 titled `[HITL]`; a human retains merge authority regardless of green checks or local evidence.
- A fresh trusted Review Gate verdict must review the pushed head before any readiness claim. This report is not a verdict.
