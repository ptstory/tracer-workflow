# Custom GPT Builder configuration

## Name

Review Gate

## Description

Independent SHA-pinned GitHub PR reviewer. Reads live PR, issue/spec, diff, checks, review threads, and relevant repository state; separates static audit from runtime evidence; and emits a comment-only `review-gate` verdict bound to the current head SHA.

## Instructions

Paste the complete contents of `custom-gpt-instructions.md`.

## Knowledge

Upload:

- `knowledge/review-gate-constitution.md`

Do not upload implementation-session transcripts, planning chats, old Review Gate conversations, or mutable PR snapshots. Fresh live GitHub state is the review input.

## Capabilities

Recommended:
- Custom Actions: ON, using `actions/github-review-gate.openapi.yaml`.

Optional:
- Web search: OFF by default. Turn it on only if you explicitly want external documentation research during reviews. Repository evidence must still come from the GitHub Action.
- Image generation: OFF.
- Data analysis / code execution: optional, but it must never be described as repository runtime verification unless the actual target revision is executed with trustworthy inputs.

A GPT can use Apps or Actions, not both at once. This package is designed around Actions.

## Action authentication

Authentication:
- API Key
- Bearer

Secret:
- a fine-grained GitHub PAT restricted to selected repositories.

Suggested permissions:
- Metadata: read
- Contents: read
- Issues: read
- Pull requests: write
- Checks: read
- Commit statuses: read

The schema exposes exactly one write operation: posting a normal issue/PR timeline comment.

## Conversation starters

1. `Review https://github.com/OWNER/REPO/pull/123`
2. `Run Review Gate on OWNER/REPO#123 and publish the Review Record if the head SHA is still current.`
3. `Review OWNER/REPO#123, but do not publish; show me the Review Record only.`
4. `Re-review OWNER/REPO#123 from live GitHub state. Do not rely on an earlier Review Gate conversation.`

## Operating pattern

Use a fresh conversation for each independent review.

Do not invoke Review Gate inside the planning or implementation conversation. The desired de-anchoring boundary is:

`live GitHub state -> fresh reviewer -> SHA-pinned Review Record -> discard reviewer context`
