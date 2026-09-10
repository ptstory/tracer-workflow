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

## Import into a Custom GPT

In the GPT builder:

1. Add an Action.
2. Choose Import from URL.
3. Use the raw GitHub URL for github-readonly.yaml.
4. Configure authentication separately using a fine-grained GitHub PAT.
5. Never put a token or Authorization header in this repository or schema.

Expected raw URL shape:

[https://raw.githubusercontent.com/OWNER/tracer-workflow/main/actions/github/github-readonly.yaml](https://raw.githubusercontent.com/OWNER/tracer-workflow/main/actions/github/github-readonly.yaml)

## Recommended fine-grained PAT permissions

For the complete schema:

- Metadata: Read-only
- Contents: Read-only
- Issues: Read-only
- Pull requests: Read-only
- Actions: Read-only

Restrict repository access to only the repositories the GPT needs.

If workflow-run inspection is removed from the schema, Actions permission can also be omitted.

Organization-owned private repositories may require organization approval for PAT access.

## Security model

The OpenAPI schema is public configuration and may safely live in a public repository.

Credentials are configured separately in the Custom GPT Action authentication settings.

Prefer separate PATs for different privilege levels.

A read-only auditor should not receive write permissions simply because another GPT uses them.

## Available operations

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

## Design principle

Schemas in this directory are reusable capability contracts, not GPT-specific prompts.

Keep GPT behavior/workflow instructions in the GPT itself.
Keep GitHub API access definitions here.
Keep authentication secrets outside the repository.
