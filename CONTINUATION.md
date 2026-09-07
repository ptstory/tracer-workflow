# Continuation pointers

Tracer separates two questions that are easy to conflate:

1. **What workflow stage is next?** Durable GitHub state answers this.
2. **Where should that stage run?** A continuation pointer may recommend a surface or existing session.

GitHub remains authoritative. Continuation pointers optimize navigation and context reuse; they never override the issue, PR, current head SHA, review verdict, check state, branch state, or checkpoint state.

If a pointer is missing, stale, unsafe to publish, or unusable, start a fresh context from the durable artifact. Correctness must not depend on recovering an old chat or process.

## Canonical pointer

Each active issue or PR may have at most one active continuation-pointer comment, identified by:

```text
<!-- tracer-continuation:v1 -->
```

Update the existing marked comment instead of appending competing pointers.

Use this shape:

```markdown
<!-- tracer-continuation:v1 -->
## Tracer continuation

artifact: <canonical GitHub issue/PR URL>
stage: <triage | implementation | review | review-fix | merge | selection | recovery>
surface: <ChatGPT | OpenCode | GitHub | terminal>
session-policy: <continue-preferred | fresh-required | fresh-preferred | n/a>
session-locator: <safe locator, or omitted>
implementation-locator: <safe implementation-session locator, or omitted>
branch: <branch, when relevant>
head-sha: <full SHA, when PR-head-sensitive>
as-of: <ISO-8601 timestamp>
source-class: <verified-via-gh | verified-on-disk | reported>
next-action: <one exact invocation/action with artifact reference>
fallback: start fresh from the durable artifact if the locator is unavailable or stale
```

`implementation-locator` is sticky provenance for the implementation lane. It is useful when the immediate next step is a fresh review but a later `needs-fix` verdict should preferentially return to the implementation session that owns the branch. It remains optional and non-authoritative.

## Validity and privacy

- The pointer lives on the artifact that owns the next transition: issue before a PR exists; PR once implementation has a PR.
- For PR-head-sensitive transitions, `head-sha` must match the current PR head. A mismatch makes the pointer stale.
- `source-class: reported` is advisory and must be reverified before being used as a premise.
- Never publish secrets, signed URLs, private share tokens, or unsafe local paths to preserve continuity.
- A ChatGPT conversation URL is not required. Prefer a safe searchable label when the thread itself is private.
- A safe OpenCode session ID may be recorded when it does not expose private data.
- If the pointer disagrees with current GitHub state, current GitHub state wins and the pointer must be recomputed.
- A pointer may recommend an old session only while that session is still healthy and attached to the correct artifact/role. Otherwise use the fallback.

## Session-boundary rule

Start fresh when the **role, durable input contract, issue, or reviewed head SHA changes**.

Continue when the **same actor is continuing the same artifact in the same role** and the session remains healthy.

Same-session continuity is an optimization, never a precondition for resuming work.

## Stage matrix

| Transition | Session rule | Pointer behavior |
|---|---|---|
| planning → `to-issues` | Continue the originating ChatGPT conversation. | No pointer is required until a durable issue exists. |
| planning → `gh-triage-queue` | Start a fresh ChatGPT conversation. | Repository-wide selection should not inherit planning momentum. |
| queue → uniquely selected first `agent-brief` | Continue the same triage conversation. | When the brief is posted, write/update the issue pointer for the selected next stage. |
| ready issue → `from-issue` | Start a fresh OpenCode implementation session for that issue by default. | Issue pointer names OpenCode and the exact `from-issue` invocation. Record a safe implementation locator when available. |
| implementation → PR | Preserve the implementation lane as the preferred return lane. | PR pointer routes the immediate next step to a fresh `review-gate` and retains `implementation-locator` if safely available. |
| PR head → `review-gate` | Fresh ChatGPT/web reviewer for every new head SHA. | `session-policy: fresh-required`; bind `head-sha` to the reviewed/current head. |
| current `needs-fix` → `from-pr-review` | Continue the implementation session when healthy. | Refresh pointer to OpenCode + `continue-preferred`; use `implementation-locator` if valid, otherwise resume fresh from PR + branch + verdict. |
| pushed fix/new head → `review-gate` | Fresh reviewer again. | Refresh pointer to `fresh-required` and bind the new head SHA. |
| current `merge-candidate` | Human GitHub merge. | Pointer becomes GitHub / `n/a` with the exact PR action. |
| merged → `next` | Any healthy read-only selector context is acceptable. | The next selected issue starts a fresh implementation lane. |
| execution crash before durable PR/output | Pointer alone is insufficient. | Use the checkpoint/recovery contract tracked in #33. |

## Stage responsibilities

### `agent-brief`

After successfully posting an action-ready issue brief, write or refresh the issue pointer. For `ready-for-agent`, the normal next action is a fresh OpenCode `from-issue` run. A queue-only result does not invent an implementation pointer.

### `from-issue`

When implementation begins, refresh the issue pointer with the current implementation lane if a safe locator is available. When a PR is opened or updated, write or refresh the PR pointer so the immediate next step is a fresh `review-gate`, while retaining the safe implementation locator for a possible review-fix return.

### `review-gate`

Review remains independent and fresh per head SHA. After publishing a conforming verdict:

- `needs-fix` → refresh the PR pointer to `from-pr-review`, OpenCode, `continue-preferred`; preserve a valid `implementation-locator` from the prior pointer when available;
- `merge-candidate` → refresh the pointer to the human GitHub merge action;
- `needs-human` / `blocked` → refresh the pointer to the one exact human/recovery action;
- never reuse the review conversation as the implementation continuation lane.

### `from-pr-review`

Prefer the implementation lane named by a valid pointer, but validate the PR, branch, and head before acting. After pushing a new head, refresh the pointer back to a fresh `review-gate` for that exact head SHA.

## Relationship to other Tracer contracts

Continuation pointers are deliberately small. They do not absorb adjacent responsibilities:

- #33 owns crash-safe in-stage checkpoints and partial execution durability.
- #35 owns deterministic `tracer resume` routing. It should derive the next stage from durable state first, then use a valid pointer only to choose the preferred surface/session.
- #38 owns cross-artifact `tracer now` prioritization.
- #77 owns general freshness/source-class policy; pointers use compatible `as-of` and `source-class` fields.
- #94 owns the workflow-wide actionable-link rule.

No external session database, dashboard, transcript archive, or hosted coordinator is required.
