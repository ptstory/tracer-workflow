# Review Gate auto-merge workflow

The auto-merge workflow is enabled only for this repository. It reevaluates a
current trusted `merge-candidate` after the verdict/readiness workflow, CI, or
check completion; it verifies the current PR head, mirrored verdict label,
blocking labels, readiness report, and required checks before guarded squash
merge. Gate Readiness Reevaluate dispatches a follow-up run after it has finished
processing a verdict comment so the auto-merge decision cannot race ahead of its
report or labels.

## Required repository secret

Configure `TRACER_MERGE_TOKEN` as a fine-grained personal access token scoped to
this repository, with exactly these required permissions:

- **Administration: read**, to retrieve the base branch's protection and
  required status-check configuration.
- **Contents: read and write**, so the squash merge triggers push workflows on
  `main`.
- **Pull requests: read and write**, to inspect and merge the guarded PR.

The workflow uses this secret for both the required-check configuration lookup
and the merge. If it is missing, or GitHub denies the configuration lookup, the
workflow fails closed and posts a stop comment. It never falls back to
`GITHUB_TOKEN` for either operation. The workflow's `GITHUB_TOKEN` is limited to
PR/check reads and stop or completion comments.

## Readiness behavior

When required checks are configured, every applicable check must be successful
on the exact current PR head. If no required checks are configured, at least one
green CI/check run on that head is required; readiness remains bound to the
current trusted verdict and the Review Gate contract's changed-path coverage
rule. A missing, pending, failed, unverifiable, or stale condition stops the
merge. The workflow rereads verdict, PR state, labels, and checks before merge,
then uses `--match-head-commit` to prevent merging a different head.
