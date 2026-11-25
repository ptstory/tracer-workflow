# Continuity preflight prompt

Use before substantial planning in ChatGPT/Claude web sessions or local agent contexts with read access to the same GitHub repository. Supply `<OWNER/REPO>`, a concrete topic/request, and optionally the current recommended next action with its source. This prompt is the canonical reusable contract; do not rely on private chat history.

## Invocation

```text
Run the Tracer continuity preflight for <OWNER/REPO>.
Topic/request: <substantive planning topic>
Current recommended next action: <item URL and why it is recommended, or none recorded>
Optional related issue/PR URLs: <URLs, or none>
Read-only only. Do not create or update GitHub issues, pull requests, comments, labels, dependencies, branches, worktrees, or persistent state.
```

Use the same prompt and result contract in web planning and local agent contexts. Each consumer must use its own existing GitHub read access. A prompt invocation or repository source does not prove that an installed web skill loaded this revision; report deployment and parity as unverified unless directly observed.

## Task

Before substantive planning or any planning write, determine whether the proposed topic is already governed by live or historical repository work, and where distinct work belongs relative to the current recommendation. This is a scoped intake check, not a queue, total ranking, priority engine, dependency graph, project board, or planning methodology.

GitHub is the durable source of truth. Resolve the explicit repository authority, live default branch, current head revision, and observation time. Do not use chat memory as evidence. Read-only access only: make no GitHub or local state writes. Recommendations to create, update, supersede, close, split, or reprioritize work are not authorization to do so.

## Evidence gathering

1. Search exact issue/PR references first, then bounded topic terms and only necessary synonyms. Inspect relevant open and closed issues and open, merged, and closed PRs. Report which search classes, pages, and candidate artifacts were inspected. A no-result means only that no result was observed within this stated coverage.
2. Read relevant candidate titles, full bodies, comments, state, labels, closing references, explicit supersession/continuation decisions, and later changes. Follow direct candidate relationships and inspect closure reasons; closed does not mean complete. Use code, commits, or current-head PR/check evidence only when material to the proposed topic or status claim.
3. Bound candidate expansion. Do not perform a repository-wide retrospective audit. State uninspected pages, truncation, search limits, permission failures, inaccessible artifacts, and unobservable local or vendor work as coverage gaps. Do not infer that no local WIP exists when it is not observable.
4. Prefer explicit metadata and owner decisions. Model judgment may identify a possible semantic overlap, but may not invent a binding decision, claim a genuinely new item when a current conflict is unresolved, or close/supersede work automatically.
5. Distinguish workflow state from dependencies. Use native GitHub dependency reads where available. If explicit dependency prose conflicts with native metadata, report both sources and stop the affected eligibility/placement decision; do not create or repair edges here. Distinguish blockers from merely related work.
6. Use a current recommended next action only when its evidence and provenance are supplied or observable. If absent, stale, inaccessible, or unresolved, say none/unknown; do not invent an operational `next` selector. Consume native dependency policy from #29 when it exists and canonical P0/P1/P2 policy from #30 when implemented. Until those interfaces are available, any urgency comparison is a separately evidenced provisional rationale, not an applied label or global winner. #37/#38 own global frontier/operator summary and must not be duplicated here.
7. For an already identified PR, reuse the repository's PR-only resume/gate-state route where available, or cite the live current-head evidence inspected. Do not duplicate verdict parsing or treat PR routing as issue/fleet selection.
8. If a fresh preflight result is reused for the same repository, topic, and scope, check that its revision and material evidence are still current. Refresh affected reads if state may have changed before a separate planning write. Existing issue execution with a complete contract and routine CI, review, or status updates do not require a new full preflight.

## Required result

Return one compact, portable result. Cite direct artifact URLs for every material claim and current recommendation. Keep recommendations distinct from observed state.

```markdown
# Continuity preflight: <owner/repo>

- Topic: <scope>
- Default branch / observed head: <branch>@<full SHA or unresolved>
- Observed at: <timestamp and timezone>
- Coverage: <open/closed issues and PRs, exact references/terms, inspected pages/candidates>
- Degraded inputs: <none, or missing reads/pages, permissions, truncation, unobservable local/vendor work>

## Relevant evidence

| Artifact | State | Relationship | Material decision/change | Evidence |
|---|---|---|---|---|
| <issue or PR URL> | active / blocked / stale / superseded / partially implemented / complete / closed-not-planned / unknown | binding / blocker / related / conflict / unknown | <observed fact, or unknown> | <source URLs, including later changes when relevant> |

## Outcome

- Disposition: <continue/update existing work / reconcile / supersede / close / split / create genuinely distinct work / human decision; recommendation only>
- Placement: <relative to open issues and active PRs; reason; preserve current recommendation, propose displacement, or unknown>
- Dependencies: <blockers versus related work; native/prose agreement or conflict; #29 interface state>
- Priority: <observed canonical priority and source, or provisional/unknown rationale; never claim an unapplied label>
- Displacement: <yes / no / unknown; reason and evidence; a proposed urgent displacement is not a global winner>
- Next action: <exactly one concrete linked action, or explicit stop/recovery action>
- Writes: none; any eventual planning write requires a separate explicit action

## Runtime/deployment evidence

- Invocation surface and result actually observed: <details, or unavailable/unverified>
- ChatGPT/Claude source loading or parity: <direct evidence, or unverified>
- Model-evaluation evidence: <observed invocation and outputs, or not run>
- Deterministic fixture evidence: <test command and result, or not run>
```

If no artifacts are relevant and coverage is adequate, say so explicitly and identify the search scope. Distinguish closed-not-planned, superseded, partially implemented, complete, and unknown. If overlap is ambiguous, recommend human decision or inspection, never append new work as if it were distinct. If evidence is incomplete, stale, contradictory, or the current recommendation cannot be resolved, stop the affected intake decision and give exactly one read/recovery action instead of authorizing new work.

## Placement contract

Compare only the proposed topic with cited current work; do not rank all backlog items. State whether the work is blocked by an open dependency or merely related. Preserve a current recommendation unless cited evidence supports proposing displacement; explain the urgency, blocker, and active-work cost in plain language. New urgent work may be proposed to displace current work but is not automatically executable. New lower-urgency work remains behind current work absent evidence to displace it. Where #29 native dependency reads or #30 priority output are not implemented or observable, mark placement provisional/unknown rather than emulating either contract. Do not add labels, issue dependencies, total 1..N ranks, a second graph, or a global selector.

## Limits

This preflight is a read-only prompt contract, not mechanical enforcement. Direct GitHub edits outside a caller and unobserved vendor deployments cannot be prevented by it. An authorized substantive write belongs to a separate explicit action and should refresh any evidence that may have changed. Ordinary CI/review/status handling and execution of an existing issue with a complete contract are exempt from a full intake audit.
