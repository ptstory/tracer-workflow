# tracer-workflow

Issue-backed, PR-mediated, evidence-first AI coding workflow.

**Planes.** ChatGPT-web / Claude plan and review. OpenCode executes. GitHub
(issues, PRs, commits, comments, check runs) is the durable coordination layer —
the source of truth, not any chat transcript.

If you're reading this because you forgot what the workflow was: the chain is
below, the skills are in `skills/`, and the two rules that are *yours* (not
inherited from the adopted skills) are the evidence-bundle contract and the
check-run gate. Those two are the load-bearing parts.

## The chain

```
idea → to-issues → triage → from-issue → PR
     → requesting-code-review → from-pr-review ⇄ receiving-code-review
     → check-run gate → merge (or follow-up issue)
     → next → (back to from-issue)
```

`next` is the loop-closer: after a merge, it tells you what's eligible to work
next, so "PR merged, now what" has an answer instead of a cold-start roadmap ask.

| Skill | Source | Role |
|---|---|---|
| `to-issues` | Matt Pocock (adopted) | messy idea → scoped GitHub issues, one vertical slice each. Tags each issue HITL or AFK **at creation**. |
| `triage` | Matt Pocock (adopted) | label + sort. Only `ready-for-agent` issues are eligible for `from-issue`. |
| `from-issue` | custom | one `ready-for-agent` issue → branch → smallest safe slice → PR with an evidence bundle. One issue, one PR. |
| `requesting-code-review` | REPOZY (adopted) | reviewer side. Security pass, severity-blocks-merge, produces a merge-readiness verdict. |
| `from-pr-review` | custom | **plumbing** for the return leg: read review threads, apply fixes, verify against real check-runs, reply per-thread, re-push, emit handoff. Delegates every judgment call to `receiving-code-review`. |
| `receiving-code-review` | REPOZY (adopted) | **judgment**. Per review item: fix now / scope creep / follow-up issue / defer. Forbids "good catch" / agreeing before verification. |
| `next` | custom | loop-closer. After merge, lists open `ready-for-agent` issues with no open blockers → hand one to `from-issue`. Read-only. |

## The two rules that are yours

These are not in the adopted skills. The adopted skills trust *reported* command
output — the narrated-confidence failure mode. These exist to close that.

**1. Evidence-bundle contract.** A `from-issue` PR body is an evidence bundle:
exact local commands run and their output, anchored to a specific head SHA. Prose
claims ("tests pass") are an index, not evidence. The bundle is what
`requesting-code-review` audits.

**2. Check-run gate.** Merge-readiness may not be asserted "ready" while any
required check is pending or red for the current head SHA — regardless of diff
quality or of any agent's prose claim that tests passed. Readiness is read from
actual check-run state (`gh pr checks` / GitHub API), never from a report.

> This is the exact failure the gate exists for: an agent declaring a PR
> "mergeable" off reported test passes, without reading the check-run state for
> the head SHA it just pushed.

## HITL / AFK

The autonomy call is made **at issue creation**, in the planning plane, with full
context — not inferred by a worker mid-session.

- **AFK issue** — pre-authorized for the autonomous path. `from-issue` and
  `from-pr-review` may run the loop and land it once the check-run gate is green.
- **HITL issue** — the human owns the merge button. Agents may push fixes, reply
  to threads, and report a green gate, but do not merge.

Anything touching write endpoints, auth paths, public surface, or live infra
(NUC / homelab) is HITL by default.

## Where things live

- Canonical source of truth for custom skills: **this repo**, `skills/`.
- Runtime: `~/.agents/skills/<name>` symlinks into this repo, so there is one
  copy and the repo is authoritative. (The adopted skills — to-issues, triage,
  requesting/receiving-code-review — are separate copies from their upstreams;
  only the custom skills are symlinked here.)
- Per-repo contract: each project gets an `AGENTS.md` / `WORKFLOW.md` pointer and
  its label mapping via `setup-matt-pocock-skills`.
