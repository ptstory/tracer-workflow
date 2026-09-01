# tracer-workflow

Issue-backed, PR-mediated, evidence-first AI coding workflow.

[CONTEXT.md](./CONTEXT.md) defines the terms used here: evidence bundle, verdict
value, slice contract, HITL/AFK, and plane.

**Planes.** ChatGPT-web / Claude plan and review. OpenCode executes. GitHub
issues, PRs, commits, comments, and check runs form the durable coordination
layer and source of truth. Chat transcripts are disposable.

If you're reading this because you forgot what the workflow was: the chain is
below, the skills are in `skills/`, the plain reusable prompts are in `prompts/`,
and the repo-owned rules are the evidence-bundle contract, the slice-contract
rule, and the check-run gate. `using-superpowers` is optional guardrail context,
not a global router that overrides this workflow. `from-issue` is the execution
stage for a `ready-for-agent` issue, or for a validated pasted implementation
handoff / durable agent brief that has been accepted as equivalent execution
input; it resumes the same issue/worktree when present, and completes at PR +
evidence bundle. Once it accepts action-ready input, nested brainstorming/planning/`using-superpowers`
steps are subordinate subroutines and must return control to execution. An
ordinary `Approve this direction` / design-approval checkpoint only ends the run
if it names a concrete unresolved blocker absent from the issue or brief.
Multi-file scope, UI impact, a desire for planning, or a nested skill's default
approval checkpoint are not blockers by themselves. Review, check-run, and merge
stay downstream in subordinate lanes. Handoff-only only for genuine blockers or
verified failures that cannot be recovered locally.

## The chain

```
chat / PRD / messy idea → to-issues → triage-queue → agent-brief → next → from-issue
     → PR with closing issue reference + evidence bundle
     → requesting-code-review → from-pr-review ⇄ receiving-code-review if judgment is needed
     → retest → check-run gate → merge candidate / human stop / follow-up issue
     → next
```

`triage-queue` is the shallow repository-wide selector. It recommends how open
issues and external PRs should move through the state machine, but does not
change labels, close issues, or write durable briefs. `wontfix-candidate` is a
queue recommendation. `wontfix` is a deep-triage decision made by `agent-brief`
or the maintainer.

`agent-brief` is the deep single-item triage pass. It turns one selected issue or
PR into the durable GitHub comment that supports `ready-for-agent`, `needs-info`,
`ready-for-human`, or `wontfix`. For issues, a `ready-for-agent` brief is the
normal contract later consumed by `from-issue`. For PRs, an agent brief is a
human coordination artifact unless a downstream workflow explicitly consumes PR
briefs. `from-pr-review` consumes review-gate verdicts and review threads.

`next` is the state-machine selector after merge. It lists `ready-for-agent`
issues whose blockers are closed and contract-satisfying.

| Skill / prompt | Owner | Role |
|---|---|---|
| `to-issues` | adopted (Matt Pocock) | messy idea → scoped GitHub issues, one vertical slice each. Tags each issue HITL or AFK **at creation**. |
| `triage-queue` | Tracer custom prompt | repository-wide shallow issue/PR pass; recommends states for maintainer selection only. |
| `agent-brief` | Tracer custom prompt | deep single issue/PR triage; writes the durable handoff comment for delegation or human stop. |
| `from-issue` | Tracer custom skill | execution stage: one `ready-for-agent` issue, validated pasted implementation handoff, or validated pasted durable agent brief → durable brief + issue worktree → smallest safe slice → PR with a closing issue reference + evidence bundle. Review, check-run, and merge remain downstream. Handoff-only only for genuine blockers or verified failures that cannot be recovered locally; no duplicate implementation handoff for the same issue. |
| `requesting-code-review` | adopted (REPOZY) | reviewer side. Security pass, severity-blocks-merge, produces a merge-readiness verdict. |
| `from-pr-review` | Tracer custom skill | **plumbing** for the return leg: read review threads, apply fixes, verify against real check-runs, reply per-thread, re-push, emit handoff. Delegates every judgment call to `receiving-code-review`. |
| `receiving-code-review` | adopted (REPOZY) | **judgment**. Uses the canonical verdict contract in `skills/review-gate/references/verdict-contract.md`. Forbids "good catch" / agreeing before verification. |
| `next` | Tracer custom skill | loop-closer. After merge, lists open `ready-for-agent` issues with no open blockers → hand one to `from-issue`. Read-only. |

## Triage depth rule

Repository-wide triage stops at queueing. It may recommend states and identify
promising `ready-for-agent` candidates, but it does not complete the deeper
contract for every issue in one session.

Deep triage handles one issue or PR at a time. Before an item becomes safe for an
AFK agent, `agent-brief` gathers context, checks current repo state, identifies
scope boundaries, and writes concrete acceptance criteria.

Low-confidence queue recommendations route to `deep-triage` or
`human-decision`. They are not action-ready.

This preserves the workflow invariant that `from-issue` consumes one durable
GitHub artifact whose contract is specific enough to execute without relying on
chat memory. The durable issue brief, a validated pasted implementation handoff,
or a validated pasted durable agent brief are all execution inputs once
validated; the later review lanes are separate contracts, not nested inside
`from-issue`.

## The three repo-owned rules

Tracer adds these rules because the adopted skills trust reported command output.
That creates a narrated-confidence failure mode.

**1. Evidence-bundle contract.** A `from-issue` PR body contains the exact local
commands run and their output, anchored to a specific head SHA. Prose claims such
as "tests pass" only index the evidence. `requesting-code-review` audits the
bundle itself.

**2. Check-run gate.** Merge readiness cannot be `ready` while any required
check is pending or red for the current head SHA, regardless of diff quality or
an agent's claim that tests passed. Readiness comes from actual check-run state
(`gh pr checks` / GitHub API).

**3. Slice-contract rule.** A downstream issue may start only when the upstream
blocker supplies the exact data, API, behavior, or file contract it consumes. A
closed blocker alone does not satisfy the contract. If the contract is missing,
ambiguous, stale, or weaker than needed, stop planning or implementation and
request the contract first.

**4. Durable blocker / verified-failure recovery.** If a blocker is durable or a failure is verified and cannot be recovered in the current worktree, `from-issue` stops with a blocker handoff that names the blocker, the failure, and the next recovery contract. It does not flatten that recovery into review, check-run, or merge. The terminal outcomes are limited to: PR opened with closing issue reference + evidence bundle; existing PR/worktree resumed and advanced; explicit durable blocker naming the exact missing prerequisite or decision; verified failure with the exact recovery state persisted.

> Case study: Issue 6 / PR 8 failed because the downstream slice was allowed to
> proceed before the upstream contract it depended on was made explicit.

## Resumability

Every stage reads its input from a GitHub artifact such as an issue, PR, verdict
comment, or check-run state, then writes its output as another GitHub artifact.
No stage requires session memory from a previous stage. The workflow can resume
from any stage in any tool by pointing that stage at the relevant GitHub
artifact. The same property keeps it tool-agnostic across ChatGPT, Claude, and
OpenCode.

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

- **Resumable between stages, not within one.** If a stage dies with
  uncommitted local work, GitHub has no artifact to resume from. Re-run the stage.
  `from-issue` inspects dirty checkout/worktree state explicitly and resumes the
  same issue/worktree when it is safe to do so, rather than spawning a fresh
  implementation handoff. If the dirtiness is unrelated or genuinely blocks
  execution, or a failure is verified and cannot be recovered locally, it stops
  with a blocker handoff. Incremental commits shrink this dead zone.
- **Fix-pass resume is bound to the reviewed head SHA.** A verdict is valid only
  for the head it reviewed. If the head moved, `from-pr-review` does nothing
  until a fresh review runs against the current head.

## HITL / AFK

The autonomy decision is made at issue creation in the planning plane with full
context. Workers do not infer it mid-session.

- **AFK issue**: pre-authorized for the autonomous path. `from-issue` and
  `from-pr-review` may run the loop and land it once the check-run gate is green.
- **HITL issue**: the human owns the merge button. Agents may push fixes, reply
  to threads, and report a green gate, but do not merge.

Anything touching write endpoints, auth paths, public surface, or live infra
(NUC / homelab) is HITL by default.

## Where things live

- Canonical source for Tracer custom skills: this repo, under `skills/`.
- Plain reusable prompts that are not runtime skills: `prompts/`.
- Runtime skills: `~/.agents/skills/<name>` symlinks into this repo where a
  prompt or skill is installed as a runtime skill, leaving one authoritative
  copy.
- Adopted skills (`to-issues`, `requesting-code-review`, `receiving-code-review`)
  live in their upstream skill repos or copies and are consumed here.
- Per-repo contract: each project gets an `AGENTS.md` / `WORKFLOW.md` pointer and
  its label mapping via `setup-matt-pocock-skills`.
