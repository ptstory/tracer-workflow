# Review Gate — Custom GPT package v1.3.0

This folder holds only what changed since `v1.2.0`. Everything else stays at its
`v1.2.0` path, which is immutable.

## What the live GPT should contain

| GPT field | Source in this repository |
|---|---|
| Instructions | `actions/review-gate-gpt/v1.3.0/custom-gpt-instructions.md` (paste the whole file; it must stay under 8,000 characters) |
| Knowledge | `actions/review-gate-gpt/v1.1.0/knowledge/review-gate-constitution.md` |
| Knowledge | `actions/review-gate-gpt/v1.2.0/knowledge/review-gate-procedure-extras.md` |
| Knowledge | `skills/review-gate/references/verdict-contract.md` (canonical; re-upload whenever it changes on `main`) |
| Action schema | `actions/review-gate-gpt/v1.1.0/actions/github-review-gate.openapi.yaml` (unchanged; no re-import needed) |
| Action auth | dedicated review account PAT; see `actions/review-gate-gpt/v1.1.0/actions/IMPORT.md` |

Builder fields: `../v1.2.0/builder.md`.

## Changes from v1.2.0

- `getBranch protected: false` is sufficient evidence that there are no classic required checks; `/protection` is not required.
- If `rules/branches/{branch}` is rejected by the connector with HTTP 400 before reaching GitHub, fall through to `rulesets`.
- The exact plan-upgrade message is accepted from either rules endpoint; other responses remain `indeterminate` blockers.
- For `blocked` verdicts, `blocking-set` lists every file with a `fix-now` finding.

Follow the v1.2.0 load-check and known-gap guidance.
