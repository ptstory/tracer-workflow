# Review Gate — Custom GPT package

This package implements the independent, disposable reviewer we planned for the Tracer workflow.

## Contract

Review Gate does one thing: review the current state of a GitHub pull request and emit a SHA-pinned Review Record.

It is **not** the workflow coordinator and has **no merge authority**.

Canonical flow:

`planner/agent -> GitHub -> fresh Review Gate session -> Review Record -> Tracer evaluator -> next action`

GitHub is the durable system of record. The Review Gate conversation is disposable.

## Important current ChatGPT deployment note

OpenAI's current documentation says new GPT creation/publishing is not available on personal Free, Go, Plus, or Pro accounts. Existing GPTs can still be usable, and editing may remain available depending on account/workspace permissions. Business, Enterprise, and Edu workspaces can allow GPT creation/editing/publishing.

If you have an existing editable GPT, this package can be pasted into it. Otherwise use a workspace where GPT creation is enabled.

## Package contents

- `builder.md` — exact Custom GPT Builder fields and settings.
- `custom-gpt-instructions.md` — paste into the GPT Instructions field.
- `knowledge/review-gate-constitution.md` — upload as GPT Knowledge.
- `actions/github-review-gate.openapi.yaml` — paste/import as the Custom Action schema.
- `schemas/review-record.schema.json` — logical schema for a Review Record.
- `templates/review-record.md` — canonical PR-comment format.
- `tests/reviewer-acceptance-tests.md` — acceptance/torture tests.
- `privacy-policy-template.md` — only needed if you later share/publish a GPT with Actions.

## GitHub authentication

Use the tracer-review-bot account's classic GitHub personal access token with `repo` scope as the Action's Bearer API key. See `actions/IMPORT.md` for access and expiration details. The OpenAPI schema exposes no merge, push, branch/ref, label, review-approval, workflow-dispatch, or file-write endpoint.

If you want the safest bring-up, initially remove/disable the `postReviewGateComment` operation and run read-only previews. Add comment posting only after the acceptance tests pass.

## Installation

1. Open an existing editable GPT, or create one in an eligible workspace.
2. Apply the fields in `builder.md`.
3. Paste `custom-gpt-instructions.md` into Instructions.
4. Upload `knowledge/review-gate-constitution.md` as Knowledge.
5. Add a Custom Action and import `https://raw.githubusercontent.com/ptstory/tracer-workflow/main/actions/review-gate-gpt/v1.1.0/actions/github-review-gate.openapi.yaml`.
6. Configure Action authentication as API Key -> Bearer and provide the tracer-review-bot classic PAT.
7. In Preview, run the tests in `tests/reviewer-acceptance-tests.md`.
8. Do not connect this GPT to an implementation/planning chat. Start a fresh Review Gate conversation for each review.

## Non-goals

Review Gate must never:
- push commits;
- edit files;
- merge or close PRs;
- modify branches/refs;
- apply/remove labels;
- dispatch workflows;
- change issue state;
- act as the Tracer workflow gate;
- treat its verdict as merge authorization.

A later push invalidates the prior verdict because the `head-sha:` no longer matches the PR's current head SHA.
