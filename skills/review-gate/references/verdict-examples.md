# review-gate verdict examples

## merge-candidate (configured required checks, non-draft PR)

```verdict
## review-gate: merge-candidate

head-sha: 0123456789abcdef0123456789abcdef01234567
review-round: 0
reviewed-files: 4
blocking-set:
next-action: gh pr merge 123 --squash --match-head-commit 0123456789abcdef0123456789abcdef01234567

### Standards
- [low] [defer] src/logger.ts — logging is noisy but not blocking.

### Spec
- [low] [reject] docs/readme.md — this note is outside the issue scope.

### Merge preconditions
- head is still 0123456789abcdef0123456789abcdef01234567
- readiness evidence path: available
- all applicable required checks are green on the current head
- at least one applicable required check exercises the changed paths

### Post-merge
- confirm Closes #123 closed the issue
- next eligible ready-for-agent issue
```

## merge-candidate (no required checks configured, non-draft PR)

For this round-1 example, the prior trusted round-0 verdict was emitted before
`next-action:` became mandatory. Its historical header was:

```text
## review-gate: needs-fix
head-sha: 89abcdef0123456789abcdef0123456789abcdef
review-round: 0
reviewed-files: 4
blocking-set: src/auth.ts
```

The missing `next-action:` does not erase that valid prior round. The new
verdict below uses the current writer schema, retains round 1, and counts the
legacy round when evaluating stale findings and the corrective-round breaker.

```verdict
## review-gate: merge-candidate

head-sha: 0123456789abcdef0123456789abcdef01234567
review-round: 1
reviewed-files: 4
blocking-set:
next-action: gh pr merge 123 --squash --match-head-commit 0123456789abcdef0123456789abcdef01234567

### Standards
- [low] [defer] src/logger.ts — logging is noisy but not blocking.

### Spec
- [low] [reject] docs/readme.md — this note is outside the issue scope.

### Merge preconditions
- head is still 0123456789abcdef0123456789abcdef01234567
- readiness evidence path: plan-unavailable (rulesets fall-through; getRulesForBranch returned connector HTTP 400 unsupported endpoint, then getRulesets returned the exact captured plan HTTP 403; getBranch `protected: false`)
- no required checks are configured on the target branch
- at least one green CI/check run on the current head exercises the changed paths

### Post-merge
- confirm Closes #123 closed the issue
- next eligible ready-for-agent issue
```

## merge-candidate (clean draft PR with green checks)

```verdict
## review-gate: merge-candidate

head-sha: 0123456789abcdef0123456789abcdef01234567
review-round: 0
reviewed-files: 4
blocking-set:
next-action: gh pr ready 123

### Standards
- No blocking findings.

### Spec
- No blocking findings.

### Merge preconditions
- head is still 0123456789abcdef0123456789abcdef01234567
- checks satisfy the current-head readiness path
- PR is draft; this is informational, and GitHub's native draft lock blocks merge until ready
- marking ready without a head change requires no fresh verdict

### Post-merge
- confirm Closes #123 closed the issue
- next eligible ready-for-agent issue
```

## needs-fix (draft PR with fix-now finding)

```verdict
## review-gate: needs-fix

head-sha: 89abcdef0123456789abcdef0123456789abcdef
review-round: 0
reviewed-files: 7
blocking-set: src/auth.ts
next-action: from-pr-review https://github.com/ptstory/tracer-workflow/pull/456
rebaseline: yes

### Standards
- [high] [fix-now] src/auth.ts — missing auth guard on write path.

### Spec
- [medium] [follow-up-issue] src/metrics.ts — add the optional dashboard work in a new issue.

### Merge preconditions
- head is still 89abcdef0123456789abcdef0123456789abcdef
- PR is draft; draft status does not override this needs-fix verdict
- fix-now findings resolved

### Post-merge
- confirm Closes #456 closed the issue
- next eligible ready-for-agent issue
```

## needs-fix (draft PR with PR-body contract violation)

```verdict
## review-gate: needs-fix

head-sha: 1023456789abcdef0123456789abcdef01234567
review-round: 0
reviewed-files: 3
blocking-set: .github/PULL_REQUEST_TEMPLATE.md
next-action: from-pr-review https://github.com/ptstory/tracer-workflow/pull/124

### Standards
- No blocking findings.

### Spec
- [medium] [fix-now] PR body — missing required Docs explanation violates the PR-body contract.

### Merge preconditions
- head is still 1023456789abcdef0123456789abcdef01234567
- fix-now PR-body contract violation resolved

### Post-merge
- confirm Closes #123 closed the issue
- next eligible ready-for-agent issue
```

## needs-human

```verdict
## review-gate: needs-human

head-sha: fedcba9876543210fedcba9876543210fedcba98
review-round: 3
reviewed-files: 9
blocking-set:
next-action: gh pr view 789 --web

### Standards
- [high] [fix-now] src/api.ts — regression in the write path remains the human's blocking set.

### Spec
- [medium] [follow-up-issue] docs/spec.md — defer the new example to a separate issue.

### Merge preconditions
- head is still fedcba9876543210fedcba9876543210fedcba98
- human guidance recorded for the policy call

### Post-merge
- confirm Closes #789 closed the issue
- next eligible ready-for-agent issue
```

## blocked (fix-now findings plus indeterminate readiness)

```verdict
## review-gate: blocked

head-sha: 00112233445566778899aabbccddeeff00112233
review-round: 0
reviewed-files: 2
blocking-set: src/auth.ts
next-action: gh api repos/example/project/rulesets

### Standards
- [high] [fix-now] src/auth.ts — missing authorization guard.

### Spec
- No blocking findings.

### Merge preconditions
- readiness evidence path: indeterminate (getRulesForBranch HTTP 400 unsupported endpoint; getRulesets HTTP 403 with a non-plan message)

### Post-merge
- confirm Closes #123 closed the issue
- next eligible ready-for-agent issue
```

## blocked (stale head)

```verdict
## review-gate: blocked

head-sha: 00112233445566778899aabbccddeeff00112233
review-round: 0
reviewed-files: 2
blocking-set:
next-action: gh pr checks 101

### Standards
- [high] [needs-human] src/integration.ts — the blocker is external and cannot be resolved here.

### Spec
- [low] [defer] docs/notes.md — record the downstream follow-up after the blocker clears.

### Merge preconditions
- head is still 00112233445566778899aabbccddeeff00112233
- only older-head results exist; no current-head evidence counts
- blocker resolved outside this review

### Post-merge
- confirm Closes #101 closed the issue
- next eligible ready-for-agent issue
```
