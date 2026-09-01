# tracer-workflow

Issue-backed, PR-mediated, evidence-first AI coding workflow.

[CONTEXT.md](./CONTEXT.md) defines the terms used here: evidence bundle, verdict
value, slice contract, HITL/AFK, and plane.

**Planes.** ChatGPT-web / Claude plan and review. OpenCode executes. GitHub
issues, PRs, commits, comments, and check runs form the durable coordination
layer and source of truth. Chat transcripts are disposable.

If you forgot the workflow, the chain is below. Custom skills live in `skills/`,
plain reusable prompts live in `prompts/`, and the repo-owned rules are the
evidence-bundle contract, slice-contract rule, and check-run gate.
`using-superpowers` is optional guardrail context and does not route this
workflow.

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
| `from-issue` | Tracer custom skill | one `ready-for-agent` issue → branch → smallest safe slice → PR with a closing issue reference + evidence bundle. One issue, one PR. |
| `requesting-code-review` | adopted (REPOZY) | reviewer side. Runs the security pass, treats severity as merge-blocking, and produces a merge-readiness verdict. |
| `from-pr-review` | Tracer custom skill | return-leg plumbing. Reads review threads, applies fixes, verifies real check runs, replies per thread, re-pushes, and emits a handoff. Delegates judgment to `receiving-code-review`. |
| `receiving-code-review` | adopted (REPOZY) | judgment. Uses the canonical verdict contract in `skills/review-gate/references/verdict-contract.md` and forbids agreeing with feedback before verification. |
| `next` | Tracer custom skill | loop closer. After merge, lists open `ready-for-agent` issues with no open blockers and hands one to `from-issue`. Read-only. |

## Triage depth rule

Repository-wide triage stops at queueing. It may recommend states and identify
promising `ready-for-agent` candidates, but it does not complete the deeper
contract for every issue in one session.

Deep triage handles one issue or PR at a time. Before an item becomes safe for an
AFK agent, `agent-brief` gathers context, checks current repo state, identifies
scope boundaries, and writes concrete acceptance criteria.

Low-confidence queue recommendations route to `deep-triage` or
`human-decision`. They are not action-ready.

This keeps the `from-issue` input contract durable and specific enough to execute
without chat memory.

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

> Case study: Issue 6 / PR 8 failed because the downstream slice started before
> its upstream contract was explicit.

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

- **Resumability stops at stage boundaries.** If a stage dies with uncommitted
  local work, GitHub has no artifact to resume from. Re-run the stage.
  `from-issue`'s dirty-tree handling makes that restart clean rather than a
  collision. Incremental commits shrink this dead zone.
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
