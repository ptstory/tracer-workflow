# Review Gate — Custom GPT package v1.2.0

This folder holds only what changed since `v1.1.0`. Everything else stays at its
`v1.1.0` path, which is immutable.

## What the live GPT should contain

| GPT field | Source in this repository |
|---|---|
| Instructions | `actions/review-gate-gpt/v1.2.0/custom-gpt-instructions.md` (paste the whole file; it must stay under 8,000 characters) |
| Knowledge | `actions/review-gate-gpt/v1.1.0/knowledge/review-gate-constitution.md` |
| Knowledge | `actions/review-gate-gpt/v1.2.0/knowledge/review-gate-procedure-extras.md` |
| Knowledge | `skills/review-gate/references/verdict-contract.md` (canonical; re-upload whenever it changes on `main`) |
| Action schema | `actions/review-gate-gpt/v1.1.0/actions/github-review-gate.openapi.yaml` (unchanged; no re-import needed) |
| Action auth | dedicated review account PAT; see `actions/review-gate-gpt/v1.1.0/actions/IMPORT.md` |

Builder fields: `builder.md` in this folder.

## Changes from v1.1.0

- `next-action:` added to the required field order, matching the verdict
  contract after #179.
- A bullet glued onto the previous line in the Verdicts section was split onto
  its own line.
- Three lists moved verbatim from Instructions into
  `knowledge/review-gate-procedure-extras.md` to fit the 8,000-character limit:
  the read list, the review/verification sources list, and the audit-by-risk
  priorities.
- Three rules that existed only in `skills/review-gate/PROMPT.md` were added
  verbatim: `Door: one-way` routes to `needs-human`, the Docs-line judgment, and
  required-check determination via `getBranch` + `getRulesForBranch`.
- The verdict contract is uploaded from its canonical path instead of a stale
  copy.

## Load check after any update

In a scratch conversation (not on a PR), ask the GPT to quote, word for word:

1. the `merge-candidate` `next-action` template;
2. the draft-PR rule;
3. the `Door: one-way` rule.

A paraphrase means the file did not load.

## Known gap

The Action schema has no compare-commits operation, so round `N > 0` reviews
reconstruct "diff since last reviewed SHA" from the commit list. That is
reliable for a single corrective commit and approximate for several, which
affects circuit-breaker counting. Fixing it needs a new schema version.
