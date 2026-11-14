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

## Review-gate action queues

Use these queries to keep agent work separate from owner decisions:

```bash
# Agent action: repair the PR.
gh pr list --state open --label gate:needs-fix

# Owner action: review the human decision.
gh pr list --state open --label gate:needs-human

# Owner action: resolve or inspect the blocker.
gh pr list --state open --label gate:blocked

# Review passed; an authorized auto-merge workflow can act after its independent gate.
gh pr list --state open --label gate:merge-candidate

# Agent action: no current review-gate verdict label.
gh pr list --state open --json number,title,labels --jq '[.[] | select([.labels[].name | select(startswith("gate:"))] | length == 0)]'
```

Configure matching sections in `gh-dash` (`~/.config/gh-dash/config.yml`):

```yaml
prSections:
  - title: "Agent action: needs-fix"
    filters: is:open label:"gate:needs-fix"
  - title: "Agent action: ungated"
    filters: is:open -label:"gate:merge-candidate" -label:"gate:needs-fix" -label:"gate:needs-human" -label:"gate:blocked"
  - title: "Owner action: needs-human"
    filters: is:open label:"gate:needs-human"
  - title: "Owner action: blocked"
    filters: is:open label:"gate:blocked"
  - title: "Owner review: merge-candidate"
    filters: is:open label:"gate:merge-candidate"
```

The ungated query excludes all four verdict labels; it intentionally remains an
agent-action queue, while `needs-human` and `blocked` are owner-action queues.

## Review-gate auto-merge token

The repository auto-merge workflow requires the repository secret
`TRACER_MERGE_TOKEN`. Set it to a fine-grained personal access token scoped only
to this repository with **Administration: read**, **Contents: read and write**,
and **Pull requests: read and write**. Administration read is required to read
branch-protection required checks; Contents write is required so squash merges
trigger push workflows on `main`. The same token is used for both required-check
configuration lookup and the merge. If the secret is absent or the token cannot
read configuration, the workflow posts a stop comment and does not fall back to
`GITHUB_TOKEN` for merging.
