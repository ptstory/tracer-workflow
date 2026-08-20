# review-gate verdict examples

## merge-candidate

```verdict
## review-gate: merge-candidate

head-sha: 0123456789abcdef0123456789abcdef01234567
review-round: 0
reviewed-files: 4

### Standards
- [low] [defer] src/logger.ts — logging is noisy but not blocking.

### Spec
- [low] [reject] docs/readme.md — this note is outside the issue scope.

### Merge preconditions
- head is still 0123456789abcdef0123456789abcdef01234567
- checks remain green

### Post-merge
- confirm Closes #123 closed the issue
- next eligible ready-for-agent issue
```

## needs-fix

```verdict
## review-gate: needs-fix

head-sha: 89abcdef0123456789abcdef0123456789abcdef
review-round: 1
reviewed-files: 7

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

## needs-human

```verdict
## review-gate: needs-human

head-sha: fedcba9876543210fedcba9876543210fedcba98
review-round: 3
reviewed-files: 9

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

## blocked

```verdict
## review-gate: blocked

head-sha: 00112233445566778899aabbccddeeff00112233
review-round: 3
reviewed-files: 2

### Standards
- [high] [needs-human] src/integration.ts — the blocker is external and cannot be resolved here.

### Spec
- [low] [defer] docs/notes.md — record the downstream follow-up after the blocker clears.

### Merge preconditions
- head is still 00112233445566778899aabbccddeeff00112233
- blocker resolved outside this review

### Post-merge
- confirm Closes #101 closed the issue
- next eligible ready-for-agent issue
```
