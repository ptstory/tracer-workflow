# GitHub Actions for Custom GPTs

Reusable OpenAPI schemas for Custom GPTs that need GitHub repository access.

## github-readonly.yaml

Generic read-only GitHub access for:
- repository auditing
- code review
- architecture analysis
- planning
- research
- issue triage
- pull request inspection
- private repository inspection
- CI/run inspection

This schema intentionally contains no write, patch, or delete operations.

## github-review-gate.yaml

Narrow Review Gate access for pull request metadata, changed files, commits,
linked issues and comments, formal reviews, review comments, check runs, commit
status, and repository content.

Its only mutation is `postReviewGateComment`, which posts the canonical Review
Gate record as a normal pull request timeline comment. The schema exposes no
merge, push, ref mutation, label, workflow dispatch, formal review submission,
review-state mutation, or repository-file write operations. Before posting, the
GPT must re-fetch the pull request and confirm that the reviewed head SHA is
still current.

## Import into a Custom GPT

In the GPT builder:

1. Add an Action.
2. Choose Import from URL.
3. Use the appropriate stable versioned raw GitHub URL below.
4. Configure authentication separately using a fine-grained GitHub PAT.
5. Never put a token or Authorization header in this repository or schema.

### github-readonly.yaml

Stable v1 import URL:

https://raw.githubusercontent.com/ptstory/tracer-workflow/v1/actions/github/github-readonly.yaml

Development/current-main URL:

https://raw.githubusercontent.com/ptstory/tracer-workflow/main/actions/github/github-readonly.yaml

### github-review-gate.yaml

Stable v1 import URL:

https://raw.githubusercontent.com/ptstory/tracer-workflow/v1/actions/github/github-review-gate.yaml

Development/current-main URL:

https://raw.githubusercontent.com/ptstory/tracer-workflow/main/actions/github/github-review-gate.yaml

The `v1` branch is an intentionally pinned compatibility branch. Do not move it
for incompatible schema changes. Create a new versioned branch such as `v2`
instead.

Custom GPT Builder may retain a previously imported schema when re-importing the
same moving URL. If the imported schema is stale, delete the existing Action and
create it again from the stable versioned URL.

## Recommended fine-grained PAT permissions

Restrict repository access to only the repositories the GPT needs.
Organization-owned private repositories may require organization approval for
PAT access.

### github-readonly.yaml

- Metadata: Read-only
- Contents: Read-only
- Issues: Read-only
- Pull requests: Read-only
- Actions: Read-only

If workflow-run inspection is removed from the schema, Actions permission can
also be omitted.

### github-review-gate.yaml

- Metadata: Read-only
- Contents: Read-only
- Issues: Read and write
- Pull requests: Read-only
- Checks: Read-only
- Commit statuses: Read-only

Issues write permission is required only for `postReviewGateComment`. All other
Review Gate operations are reads.

## Security model

The OpenAPI schema is public configuration and may safely live in a public repository.

Credentials are configured separately in the Custom GPT Action authentication settings.

Prefer separate PATs for different privilege levels.

A read-only auditor should not receive write permissions simply because another GPT uses them.

## Available operations

### github-readonly.yaml

Repository:
- getRepository
- getBranch
- getCommit
- getGitTree
- getRepositoryContent

Search:
- searchCode
- searchIssuesAndPullRequests

Issues:
- listIssues
- getIssue
- listIssueComments

Pull requests:
- getPullRequest
- listPullRequestFiles
- listPullRequestReviews
- listPullRequestReviewComments

GitHub Actions:
- listWorkflowRuns
- getWorkflowRun

### github-review-gate.yaml

Pull requests and linked issues:
- getPullRequest
- listPullRequestFiles
- listPullRequestCommits
- getIssueOrPullRequest
- listIssueComments
- listPullRequestReviews
- listPullRequestReviewComments

Commit evidence and repository content:
- listCheckRunsForRef
- getCombinedCommitStatus
- getRepositoryContent

Review Gate publication:
- postReviewGateComment

## Design principle

Schemas in this directory are reusable capability contracts, not GPT-specific prompts.

Keep GPT behavior/workflow instructions in the GPT itself.
Keep GitHub API access definitions here.
Keep authentication secrets outside the repository.
