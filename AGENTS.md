# Agent Contract — ptstory/tracer-workflow

This repo uses an issue-backed, PR-mediated, evidence-first workflow.
ChatGPT-web plans and reviews. OpenCode executes. GitHub issues, PRs, commits,
comments, and check runs are the durable coordination layer.

## Issue tracker

GitHub (`gh`). Authoritative for issue scope, acceptance criteria, and state.

## Default branch

main

## Triage label mapping (canonical -> actual)

The canonical labels are intended to map identically:

```
needs-triage    -> needs-triage
needs-info      -> needs-info
ready-for-agent -> ready-for-agent
ready-for-human -> ready-for-human
wontfix         -> wontfix
bug             -> bug
enhancement     -> enhancement
```

Canonical labels were verified or created with the requested colors. Existing
labels were preserved, including `ready-for-agent` and `wontfix`; do not
recreate `bug` or `enhancement`.

## Workflow contract

Follow `WORKFLOW.md` as the repo-specific contract: GitHub is the durable source
of truth, work is one issue per branch and PR, and every PR must carry an
evidence bundle with exact commands and results anchored to its head SHA. The
check-run gate and slice-contract rule govern readiness; merge remains a manual
or explicitly authorized action. Repo-specific commands, runtime constraints,
and safety rules live in `.agents/repo-context.md`.

## TODO

<!-- scaffold leaves repo-specific TODOs here -->
