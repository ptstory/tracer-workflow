# Source-backed architecture notes

These diagrams describe `ptstory/tracer-workflow` as observed at revision
`53edae78f8f1a0ad56f1f0f19bcf69e5bdedc728`.

The editable source models are:

- `tracer-workflow-trust.architecture.json` — system-level authority, durability, and drift-detection map.
- `tracer-workflow-e2e.workflow.json` — end-to-end durable workflow and needs-fix loop.
- `tracer-workflow-pr-review.lifecycle.json` — PR/review lifecycle with SHA-staleness and stop states.

The two checked-in SVGs are reader-facing static projections for GitHub README rendering. The JSON source models preserve the richer source-backed structure and revision pin.

## Primary repository evidence

- `README.md` — core thesis, end-to-end loop, review-gate poller, unbacked-work monitor.
- `WORKFLOW.md` — planes, stage chain, evidence-bundle contract, check-run gate, resumability, HITL/AFK.
- `CONTEXT.md` — authoritative vocabulary for durable briefs, verdict values, SHA-staleness, and the check-run gate.
- `skills/from-issue/SKILL.md` — execution boundary, worktree handling, and PR/evidence terminal outcome.
- `skills/review-gate/PROMPT.md` — fresh-context reviewer, exact verdict shape, and current-head requirements.
- `skills/review-gate/references/verdict-contract.md` — append-only verdict protocol and SHA-staleness rule.
- `skills/from-pr-review/SKILL.md` — mechanical fix return leg and current-head check observation.
- `tooling/review-gate-poller/README.md` and `tooling/lib/verdict.ts` — current-head verdict consumer.
- `tooling/unbacked-work-monitor/README.md` and `tooling/unbacked-work-monitor/unbacked-work-monitor.ts` — trusted-remote retention detector.
- `.github/workflows/gate-readiness.yml` — mechanical readiness evaluation in GitHub Actions.

## Interpretation rules

1. ChatGPT, Claude, OpenCode, and local worktrees can do work but are not durable workflow authorities.
2. Authored GitHub records and observed verification are separate trust classes. Issues/briefs, PR evidence bundles, and review verdict comments are authored records; current head SHA, actual checks, and trusted-remote reachability are observed state.
3. A green gate means the configured current-head evidence contract is satisfied. It does not guarantee overall correctness.
4. Review is commit-specific. A verdict remains current only while its recorded `head-sha` equals the PR current head.
5. Local-only work is a separate durability failure mode, detected by comparing local retainers with trusted remote reachability.
6. Landing authority is fixed by the issue's HITL/AFK classification: AFK may land autonomously after the gate; HITL requires human merge.

## Drift / ambiguity found at the pinned revision

### `skills/next/SKILL.md` does not implement the documented `next` stage

`README.md` and `WORKFLOW.md` describe `next` as the loop-closing selector for executable work. The pinned `skills/next/SKILL.md` instead contains an unrelated Deliverable Package Finalizer. Issue #30 already includes repair of this mismatch, so this documentation PR does not change runtime behavior.

### Agent-brief cannot currently express the review contract's binding-scope provenance marker

The verdict contract says issue-body requirements plus brief clarifications explicitly marked as derived from the issue body are binding. The pinned `prompts/agent-brief.md` format has no explicit derived-vs-new provenance field. This documentation PR records the discrepancy without changing workflow policy.

### Merge wording was not uniform at the pinned revision

The pinned README, review-contract-adjacent docs, and poller wording emphasized a human/manual merge boundary, while `WORKFLOW.md` explicitly distinguishes AFK autonomous landing from HITL human merge. This documentation PR treats the HITL/AFK section of `WORKFLOW.md` as controlling and models both paths. It does not redefine merge authority.

## Archify validation status

The source JSON follows the Archify architecture/workflow/lifecycle schemas and was structurally sanity-checked before this PR. Archify CLI showcase validation and Archify-delivered HTML were not run in the authoring environment because the CLI was unavailable there. Do not treat the JSON as showcase-validated until the repository runs Archify's own `validate`/`deliver` commands.
