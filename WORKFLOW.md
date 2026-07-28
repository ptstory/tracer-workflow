# tracer-workflow

Issue-backed, PR-mediated, evidence-first AI coding workflow.

Terms used throughout — evidence bundle, verdict value, slice contract, HITL/AFK,
plane — are defined in [CONTEXT.md](./CONTEXT.md).

**Planes.** ChatGPT-web / Claude plan and review. OpenCode executes. GitHub
(issues, PRs, commits, comments, check runs) is the durable coordination layer —
the source of truth, not any chat transcript.

If you're reading this because you forgot what the workflow was: the chain is
below, the skills are in `skills/`, the plain reusable prompts are in `prompts/`,
and the repo-owned rules are the evidence-bundle contract, the slice-contract rule, and the check-run gate. `using-superpowers` is optional guardrail context, not a global router that overrides this workflow. `from-issue` is the execution stage for a `ready-for-agent` issue; it resumes the same issue/worktree when present, only emits a handoff-only result for a genuine blocker, and must not mint another implementation handoff for the same issue. Handoff-only only for genuine blockers.

## The chain

```
chat / PRD / messy idea → to-issues → triage-queue → agent-brief → next → from-issue
     → PR with closing issue reference + evidence bundle
     → requesting-code-review → from-pr-review ⇄ receiving-code-review if judgment is needed
     → retest → check-run gate → merge candidate / human stop / follow-up issue
     → next
```

`triage-queue` is the shallow repository-wide selector: it recommends how open
issues and external PRs should move through the state machine, but it does not
change labels, close issues, or write durable briefs. `wontfix-candidate` is only
a queue recommendation; `wontfix` is a deep-triage decision made by `agent-brief`
or the maintainer.

`agent-brief` is the deep single-item triage pass: it turns one selected issue or
PR into the durable GitHub comment that `ready-for-agent`, `needs-info`,
`ready-for-human`, or `wontfix` depends on. For issues, a `ready-for-agent` brief
is the normal contract later consumed by `from-issue`. For PRs, an agent brief is
a human coordination artifact unless a downstream workflow explicitly says it
consumes PR briefs; `from-pr-review` consumes review-gate verdicts and review
threads, not agent briefs.

`next` is the state-machine selector after merge: it lists ready-for-agent issues
whose blockers are both closed and contract-satisfying.

| Skill / prompt | Owner | Role |
|---|---|---|
| `to-issues` | adopted (Matt Pocock) | messy idea → scoped GitHub issues, one vertical slice each. Tags each issue HITL or AFK **at creation**. |
| `triage-queue` | Tracer custom prompt | repository-wide shallow issue/PR pass; recommends states for maintainer selection only. |
| `agent-brief` | Tracer custom prompt | deep single issue/PR triage; writes the durable handoff comment for delegation or human stop. |
| `from-issue` | Tracer custom skill | execution stage: one `ready-for-agent` issue → resume or create the issue worktree → smallest safe slice → PR with a closing issue reference + evidence bundle. Handoff-only only for genuine blockers; no duplicate implementation handoff for the same issue. |
| `requesting-code-review` | adopted (REPOZY) | reviewer side. Security pass, severity-blocks-merge, produces a merge-readiness verdict. |
| `from-pr-review` | Tracer custom skill | **plumbing** for the return leg: read review threads, apply fixes, verify against real check-runs, reply per-thread, re-push, emit handoff. Delegates every judgment call to `receiving-code-review`. |
| `receiving-code-review` | adopted (REPOZY) | **judgment**. Uses the canonical verdict contract in `skills/review-gate/references/verdict-contract.md`. Forbids "good catch" / agreeing before verification. |
| `next` | Tracer custom skill | loop-closer. After merge, lists open `ready-for-agent` issues with no open blockers → hand one to `from-issue`. Read-only. |

## Triage depth rule

Repository-wide triage is allowed only as a queueing pass. It may recommend
states and identify promising `ready-for-agent` candidates, but it should not
pretend to complete the deeper contract for every issue in one session.

Deep triage remains one issue or PR at a time. Before an item becomes safe for an
AFK agent, the `agent-brief` pass should gather context, check the current repo
state, identify scope boundaries, and produce concrete acceptance criteria.

Low-confidence queue recommendations are not action-ready. They must route to
`deep-triage` or `human-decision`, not straight to label/comment mutation.

This preserves the workflow invariant that `from-issue` consumes one durable
GitHub artifact whose contract is specific enough to execute without relying on
chat memory.

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
| repo has many untriaged / stale issues | `triage-queue <repo>` |
| selected issue/PR needs durable triage comment | `agent-brief <issue-or-pr-url>` |
| issue is `ready-for-human` | human reviews the brief and makes the judgment/merge/scope decision |
| issue exists, no PR | `from-issue <issue-url>` |
| PR exists, no verdict | `review-gate` against the PR |
| PR exists, `needs-fix` verdict on current head | `from-pr-review` |
| merged | `next` |

Two limits:

- **Resumable between stages, not within one.** A stage that died half-done with
  uncommitted local work has no GitHub artifact to resume from — the work is only
  in the worktree. Re-run the stage; `from-issue` inspects dirty checkout/worktree
  state explicitly and resumes the same issue/worktree when it is safe to do so,
  rather than spawning a fresh implementation handoff. If the dirtiness is
  unrelated or genuinely blocks execution, it stops with a blocker handoff. This
  is why stages commit incrementally: the more each stage persists, the smaller
  this dead zone.
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
- Plain reusable prompts that are not runtime skills live in `prompts/`.
- Runtime skills: `~/.agents/skills/<name>` symlinks into this repo where a prompt
  or skill is installed as a runtime skill, so there is one copy and the repo is
  authoritative.
- Adopted skills (`to-issues`, `requesting-code-review`, `receiving-code-review`)
  live in their upstream skill repos/copies and are consumed here; they are not
  authored by this repo.
- Per-repo contract: each project gets an `AGENTS.md` / `WORKFLOW.md` pointer and
  its label mapping via `setup-matt-pocock-skills`.
