# Runtime

This file records the **current tool bindings** for Tracer. It is non-normative:
changing a tool here must not change the workflow protocol in `WORKFLOW.md`.

## Current bindings — 2026-11-17

| Responsibility | Current runtime |
|---|---|
| Planning and interactive review | ChatGPT web / Claude web; `to-tickets` is the upstream planning method, and issues may also be filed directly. |
| Implementation and fix passes | Crush |
| Durable coordination and workflow authority | GitHub issues, pull requests, comments, commits, and check runs |
| Review gate | The `@review-gate` ChatGPT plugin in a fresh conversation; `skills/review-gate/` is the canonical contract, and `actions/review-gate-gpt/` is an available but inactive package. See #195 for the plugin implementation. |
| Review-gate poller | **Parked, not in use.** The checked-in poller is still tied to OpenCode and is tracked for runtime decoupling in #184. |

## Rules

- Product choice belongs here when swapping that product would not change Tracer semantics.
- GitHub is part of the protocol, not merely a runtime choice: durable issue/PR/check/verdict state is the coordination contract.
- Interactive sessions and local worktrees are workers, not workflow authority.
- Until #184 lands, do not treat the review-gate poller as active automation.
- Worktree layout is runtime-specific. Current Crush-created tracer-workflow worktrees are sibling directories such as `~/Code/tracer-workflow-<name>`; the workflow must not depend on that layout.
