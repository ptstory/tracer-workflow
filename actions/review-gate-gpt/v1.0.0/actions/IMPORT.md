# Import Review Gate 1.0.0

Import this pinned OpenAPI schema into the Custom GPT Action:

`https://raw.githubusercontent.com/ptstory/tracer-workflow/main/actions/review-gate-gpt/v1.0.0/actions/github-review-gate.openapi.yaml`

Configure Action authentication as **API Key -> Bearer**, then provide the fine-grained GitHub personal access token in the GPT editor. Do not commit the token.

## Fine-grained GitHub token access

Recommended repository access:
- Only the repositories Review Gate should review.

Recommended repository permissions:
- Metadata: Read-only
- Contents: Read-only
- Issues: Read-only
- Pull requests: Read and write
- Checks: Read-only
- Commit statuses: Read-only

`Pull requests: write` is needed only because the initial contract permits one write: posting the final Review Record as a normal PR timeline comment. The OpenAPI schema exposes no merge, push, branch/ref, label, review-approval, workflow-dispatch, or file-write endpoint.

## Versioning

Treat `v1.0.0` as immutable. A schema change requires a new version path rather than editing this schema in place. Import the new pinned raw URL only after that version is reviewed and merged.
