# Import Review Gate 1.1.0

Import this pinned OpenAPI schema into the Custom GPT Action:

`https://raw.githubusercontent.com/ptstory/tracer-workflow/main/actions/review-gate-gpt/v1.1.0/actions/github-review-gate.openapi.yaml`

Configure Action authentication as **API Key -> Bearer**, then provide the tracer-review-bot account's classic GitHub personal access token with `repo` scope in the GPT editor. Do not commit the token.

## GitHub token access

A fine-grained token from tracer-review-bot cannot select repositories owned by ptstory. The bot is a collaborator with write access on each private repository using the gate. The classic token expires by Dec 11 2026, when Custom GPTs retire.

The token's `repo` scope grants broader GitHub permissions than the Action exposes. Through this OpenAPI schema, the bot can only read and post one normal PR timeline comment via `postReviewGateComment`; no merge, push, branch/ref, label, review-approval, workflow-dispatch, or file-write endpoint is exposed.

## Versioning

Treat `v1.1.0` as immutable. A schema change requires a new version path rather than editing this schema in place. Import the new pinned raw URL only after that version is reviewed and merged.
