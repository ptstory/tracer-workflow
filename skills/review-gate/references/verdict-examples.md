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
- draft status is informational; changing it alone does not require another verdict at this SHA

### Post-merge
- confirm Closes #123 closed the issue
- next eligible ready-for-agent issue
```

## needs-fix

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
blocking-set: PR body
next-action: from-pr-review https://github.com/ptstory/tracer-workflow/pull/124

### Standards
- No blocking findings.

### Spec
- [medium] [fix-now] PR body — missing required Docs explanation violates the PR-body contract; edit the PR description directly.

### Merge preconditions
- head is still 1023456789abcdef0123456789abcdef01234567
- fix-now PR-body contract violation resolved in PR metadata

### Post-merge
- confirm Closes #123 closed the issue
- next eligible ready-for-agent issue
```

## needs-human (one-way door, otherwise clean)

```verdict
## review-gate: needs-human

head-sha: fedcba9876543210fedcba9876543210fedcba98
review-round: 0
reviewed-files: 9
blocking-set:
next-action: gh pr view 789 --web

### Standards
- No blocking findings.

### Spec
- No blocking findings.

### Merge preconditions
- Door: one-way
- human review required after ordinary findings are cleared

### Post-merge
- confirm Closes #789 closed the issue
- next eligible ready-for-agent issue
```

## needs-fix (one-way door with fix-now finding)

```verdict
## review-gate: needs-fix

head-sha: fedcba9876543210fedcba9876543210fedcba98
review-round: 0
reviewed-files: 9
blocking-set: src/api.ts
next-action: from-pr-review https://github.com/ptstory/tracer-workflow/pull/789

### Standards
- [high] [fix-now] src/api.ts — ordinary regression on a one-way-door PR must be fixed before human escalation.

### Spec
- No blocking findings.

### Merge preconditions
- Door: one-way
- ordinary fix-now finding takes precedence; human escalation follows after it is cleared

### Post-merge
- confirm Closes #789 closed the issue
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
- No blocking findings.

### Spec
- No blocking findings.

### Merge preconditions
- only older-head results exist; no current-head evidence counts

### Post-merge
- confirm Closes #101 closed the issue
- next eligible ready-for-agent issue
```

## needs-human (circuit breaker with surviving regression)

```verdict
## review-gate: needs-human

head-sha: 00112233445566778899aabbccddeeff00112233
review-round: 3
reviewed-files: 2
blocking-set:
next-action: gh pr view 101 --web

### Standards
- [high] [fix-now] src/auth.ts — regression remains a human blocking concern after two corrective rounds.

### Spec
- No blocking findings.

### Merge preconditions
- circuit breaker triggered after two prior corrective rounds; human guidance required before further fixes

### Post-merge
- confirm Closes #101 closed the issue
- next eligible ready-for-agent issue
```

## needs-human (explicit human-only finding)

```verdict
## review-gate: needs-human

head-sha: 00112233445566778899aabbccddeeff00112233
review-round: 0
reviewed-files: 2
blocking-set:
next-action: gh pr view 101 --web

### Standards
- [medium] [fix-now] src/config.ts — invalid default breaks the documented configuration path.

### Spec
- [high] [needs-human] src/integration.ts — approval decision outside agent authority is required.

### Merge preconditions
- explicit human-only finding takes precedence over the simultaneous fix-now finding; blocking-set remains empty

### Post-merge
- confirm Closes #101 closed the issue
- next eligible ready-for-agent issue
```

## needs-fix (fix-now findings plus indeterminate readiness)

```verdict
## review-gate: needs-fix

head-sha: 00112233445566778899aabbccddeeff00112233
review-round: 0
reviewed-files: 2
blocking-set: src/auth.ts
next-action: from-pr-review https://github.com/ptstory/tracer-workflow/pull/101

### Standards
- [high] [fix-now] src/auth.ts — missing authorization guard.

### Spec
- No blocking findings.

### Merge preconditions
- readiness evidence path: indeterminate (getRulesForBranch HTTP 400 unsupported endpoint; getRulesets HTTP 403 with a non-plan message)
- fix-now finding must be resolved before merge

### Post-merge
- confirm Closes #101 closed the issue
- next eligible ready-for-agent issue
```
