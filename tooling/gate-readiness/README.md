# Reusable gate labels

Copy [`templates/gate-labels.yml`](../../templates/gate-labels.yml) to
`.github/workflows/gate-labels.yml` in the product repository. In the
`workflow_run.workflows` list, replace `CI` with the exact names of the
repository's CI workflows. Set the repository variable with
`gh variable set TRACER_REVIEWER_LOGINS --body 'ptstory,another-reviewer'`.

The caller workflow invokes
`ptstory/tracer-workflow/.github/workflows/gate-readiness.yml@main`; it does not
check out either repository. The called workflow reads PR data and comments
through GitHub's API using the caller's `GITHUB_TOKEN` permissions. The optional
`reviewer-logins` input can supply an explicit allowlist; otherwise the reusable
workflow reads `vars.TRACER_REVIEWER_LOGINS`.

GitHub's variables documentation states: “For reusable workflows, the variables
from the caller workflow's repository are used. Variables from the repository
that contains the called workflow are not made available to the caller
workflow.” See [GitHub Actions variables]
(https://docs.github.com/en/actions/reference/workflows-and-actions/variables).
