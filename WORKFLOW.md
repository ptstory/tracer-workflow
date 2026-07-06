# tracer-workflow

Issue-backed, PR-mediated, evidence-first AI coding workflow.

**Planes.** ChatGPT-web / Claude plan and review. OpenCode executes. GitHub
(issues, PRs, commits, comments, check runs) is the durable coordination layer —
the source of truth, not any chat transcript.

If you're reading this because you forgot what the workflow was: the chain is
below, the skills are in `skills/`, and the repo-owned rules are the
evidence-bundle contract, the slice-contract rule, and the check-run gate.
`using-superpowers` is optional guardrail context, not a global router that
overrides this workflow.

## The chain

```
chat / PRD / messy idea → to-issues → triage → next → from-issue
     → PR with closing issue reference + evidence bundle
     → requesting-code-review → from-pr-review ⇄ receiving-code-review if judgment is needed
     → retest → check-run gate → merge candidate / human stop / follow-up issue
     → next
```

`next` is the state-machine selector: it lists ready-for-agent issues whose
blockers are both closed and contract-satisfying.

| Skill | Owner | Role |
|---|---|---|
| `to-issues` | adopted (Matt Pocock) | messy idea → scoped GitHub issues, one vertical slice each. Tags each issue HITL or AFK **at creation**. |
| `triage` | adopted (Matt Pocock) | label + sort. Only `ready-for-agent` issues are eligible for `from-issue`. |
| `from-issue` | Tracer custom | one `ready-for-agent` issue → branch → smallest safe slice → PR with a closing issue reference + evidence bundle. One issue, one PR. |
| `requesting-code-review` | adopted (REPOZY) | reviewer side. Security pass, severity-blocks-merge, produces a merge-readiness verdict. |
| `from-pr-review` | Tracer custom | **plumbing** for the return leg: read review threads, apply fixes, verify against real check-runs, reply per-thread, re-push, emit handoff. Delegates every judgment call to `receiving-code-review`. |
| `receiving-code-review` | adopted (REPOZY) | **judgment**. Per review item: fix now / scope creep / follow-up issue / defer. Forbids "good catch" / agreeing before verification. |
| `next` | Tracer custom | loop-closer. After merge, lists open `ready-for-agent` issues with no open blockers → hand one to `from-issue`. Read-only. |

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

**3. Slice-contract rule.** A downstream issue may only start if the upstream
blocker supplies the exact data/API/behavior/file contract it consumes. A closed
blocker is not sufficient by itself. If the contract is missing, ambiguous,
stale, or weaker than needed, stop planning or implementation and request that
contract first.

> Case study: Issue 6 / PR 8 failed because the downstream slice was allowed to
> proceed before the upstream contract it depended on was made explicit.

## Resumability

Every stage reads its input from a GitHub artifact (issue, PR, verdict comment,
check-run state) and writes its output as one. No stage depends on in-memory
session context from a prior stage. So the workflow resumes from any stage, in
any tool, by pointing the stage at the relevant GitHub artifact — the same
property that makes it tool-agnostic across ChatGPT, Claude, and OpenCode.

Resume entry points:

| State on GitHub | Resume with |
|---|---|
| issue exists, no PR | `from-issue <issue-url>` |
| PR exists, no verdict | `review-gate` against the PR |
| PR exists, `needs-fix` verdict on current head | `from-pr-review` |
| merged | `next` |

Two limits:

- **Resumable between stages, not within one.** A stage that died half-done with
  uncommitted local work has no GitHub artifact to resume from — the work is only
  in the worktree. Re-run the stage; `from-issue`'s dirty-tree handling makes that
  restart clean rather than a collision. This is why stages commit incrementally:
  the more each stage persists, the smaller this dead zone.
- **SHA-staleness bounds fix-pass resume.** A verdict is valid only on its head
  SHA. If head moved since the verdict, resuming `from-pr-review` correctly does
  nothing until a fresh review runs against current head.

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

- Canonical source of truth for Tracer custom skills: **this repo**, `skills/`.
- Runtime: `~/.agents/skills/<name>` symlinks into this repo, so there is one
  copy and the repo is authoritative.
- Adopted skills (`to-issues`, `triage`, `requesting-code-review`,
  `receiving-code-review`) live in their upstream skill repos/copies and are
  consumed here; they are not authored by this repo.
- Per-repo contract: each project gets an `AGENTS.md` / `WORKFLOW.md` pointer and
  its label mapping via `setup-matt-pocock-skills`.
