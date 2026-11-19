# tracer-workflow

Issue-backed, PR-mediated, evidence-first AI coding workflow.

[CONTEXT.md](./CONTEXT.md) defines the terms used here: evidence bundle, verdict
value, slice contract, HITL/AFK, and plane.

**Planes.** Planning/review and execution are worker responsibilities; GitHub
issues, PRs, commits, comments, and check runs form the durable coordination
layer and source of truth. Current tool bindings live in `RUNTIME.md`. Session
transcripts are disposable.

If you're reading this because you forgot what the workflow was: the chain is
below, the skills are in `skills/`, the plain reusable prompts are in `prompts/`,
and the four repo-owned rules are the evidence-bundle contract, the slice-contract
rule, the check-run gate, and durable blocker / verified-failure recovery.
`from-issue` is the execution stage for a `ready-for-agent` issue, or for a
validated pasted implementation handoff / durable agent brief that has been
accepted as equivalent execution input; it resumes the same issue/worktree when
present, and completes at PR + evidence bundle. Once it accepts action-ready
input, nested brainstorming or planning steps are subordinate subroutines and
must return control to execution. An ordinary `Approve this direction` /
design-approval checkpoint only ends the run if it names a concrete unresolved
blocker absent from the issue or brief. Multi-file scope, UI impact, a desire for
planning, or a nested skill's default approval checkpoint are not blockers by
themselves. Review, check-run, and merge stay downstream in subordinate stages.
Handoff-only is allowed only for genuine blockers or verified failures that
cannot be recovered locally.

## The chain

```
planning session → [optional upstream to-tickets] or direct issue filing
     → [optional triage-queue → agent-brief for incoming, untriaged, or incomplete issues]
     → from-issue (ready-for-agent / complete execution contract)
     → PR with closing issue reference + evidence bundle
     → @review-gate in a fresh ChatGPT conversation ⇄ from-pr-review for needs-fix
     → retest → check-run gate → merge candidate / human stop / follow-up issue

next is a safety stub until #30, not a working selector
```

`triage-queue` is an optional shallow repository-wide selector for incoming or
untriaged work, or issues whose bodies are not complete execution contracts. It
recommends how open issues and external PRs should move through the state machine,
but does not change labels, close issues, or write durable briefs. `to-tickets`
applies `ready-for-agent` itself; for other inputs, deep triage may apply that
label when the contract is complete. `wontfix-candidate` is a queue recommendation.
`wontfix` is a deep-triage decision made by `agent-brief` or the maintainer.

`agent-brief` is the deep single-item triage pass. It turns one selected issue or
PR into the durable GitHub comment that supports `ready-for-agent`, `needs-info`,
`ready-for-human`, or `wontfix`. For issues, a `ready-for-agent` brief is the
normal contract later consumed by `from-issue`. For PRs, an agent brief is a
human coordination artifact unless a downstream workflow explicitly consumes PR
briefs. `from-pr-review` consumes review-gate verdicts and review threads.

`next` is a safety stub until #30; it is not a functioning selector and must not
be treated as the post-merge route to executable work.

| Skill / prompt | Owner | Role |
|---|---|---|
| `to-tickets` | upstream (optional) | Planning method that can create scoped issues and applies `ready-for-agent` itself; issues may also be filed directly. |
| `triage-queue` | Tracer custom prompt (optional) | Shallow repository-wide issue/PR pass for incoming or untriaged work, or an issue without a complete execution contract; recommends states only. |
| `agent-brief` | Tracer custom prompt (optional) | Deep single issue/PR triage when needed; writes the durable handoff comment for delegation or human stop. `to-tickets` applies `ready-for-agent` itself; otherwise this step may add it for complete, executable work. |
| `from-issue` | Tracer custom skill | Execution stage: one `ready-for-agent` issue, validated pasted implementation handoff, or validated pasted durable agent brief → durable brief + issue worktree → smallest safe slice → PR with a closing issue reference + evidence bundle. Review, check-run, and merge remain downstream. Handoff-only only for genuine blockers or verified failures that cannot be recovered locally; no duplicate implementation handoff for the same issue. |
| `review-gate` | Tracer custom prompt / `@review-gate` plugin | Active fresh-conversation review; applies the canonical verdict contract and posts a current-head verdict. |
| `from-pr-review` | Tracer custom skill | Mechanical return leg: read review threads, apply fixes, verify against real check-runs, reply per-thread, re-push, and emit handoff. Its judgment/disposition contract is `skills/from-pr-review/references/disposition-rules.md`. |
| `next` | Tracer custom skill (stub) | Safety stub until #30; not a functioning issue selector. |

## Triage depth rule

Repository-wide triage stops at queueing. It may recommend states and identify
promising `ready-for-agent` candidates, but it does not complete the deeper
contract for every issue in one session.

When needed, deep triage handles one issue or PR at a time. Before an item becomes
safe for an AFK agent, `agent-brief` gathers context, checks current repo state,
identifies scope boundaries, and writes concrete acceptance criteria.

Low-confidence queue recommendations route to `deep-triage` or
`human-decision`. They are not action-ready.

This preserves the workflow invariant that `from-issue` consumes one durable
GitHub artifact whose contract is specific enough to execute without relying on
chat memory. The durable issue brief, a validated pasted implementation handoff,
or a validated pasted durable agent brief are all execution inputs once
validated; the later review stages are separate contracts, not nested inside
`from-issue`.

## The four repo-owned rules

Tracer adds these rules because the adopted skills trust reported command output.
That creates a narrated-confidence failure mode.

**1. Evidence-bundle contract.** A `from-issue` PR body contains the exact local
commands run and their output, anchored to a specific head SHA. Prose claims such
as "tests pass" only index the evidence. The `review-gate` audits the
evidence bundle itself.

**2. Check-run gate.** Merge readiness comes from the current head's required
status-check configuration. For a PR whose every changed path is in the docs-only
allowlist in `skills/review-gate/references/verdict-contract.md`, replace
changed-path exercise with all applicable configured required checks green at
the current head (when configured), a passing `pr-body` check at the current
head, and a clean Review Gate content review at that head. Otherwise, including
any mixed PR, if required checks are configured, all applicable required checks
must be green at the current head and at least one applicable required check
must exercise the changed paths; if no required checks are configured, at least
one green CI/check run on the current head must exercise the changed paths.
Older-head results never count. Readiness comes from actual check-run state
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
artifact. The same property keeps it tool-agnostic across runtime
implementations; current bindings are recorded in `RUNTIME.md`.

Reviewer: fresh session every round. Fixer: a new session for every needs-fix
round, never the session that implemented the PR. Round state lives on GitHub
(verdict comments, blocking set), not in session context.

Resume entry points:

| State on GitHub | Resume with |
|---|---|
| repo has many untriaged / stale issues | `triage-queue <repo>` |
| selected issue/PR needs durable triage comment | `agent-brief <issue-or-pr-url>` |
| issue is `ready-for-human` | human reviews the brief and makes the judgment/merge/scope decision |
| issue exists, no PR | `from-issue <issue-url>` |
| PR exists, no verdict | `review-gate` against the PR |
| PR exists, `needs-fix` verdict on current head | `from-pr-review` |
| merged | `next` (safety stub until #30; not a working selector) |

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

An issue is HITL by default; AFK applies only when the issue explicitly says so.
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
- Stage authority, consumers, and deployment status are recorded in the
  [workflow-stage inventory](./docs/architecture/WORKFLOW-STAGE-INVENTORY.md).
  Declare the canonical source and load/deployment mechanism there before
  describing a new Tracer-owned stage as installed. Manually synchronized
  semantic copies are not an acceptable steady state; where direct source
  loading is unavailable, the repository must own a versioned deployable
  artifact with a deterministic parity marker and observable read-back.
- Upstream planning method: `to-tickets` may be used to create issues; direct
  issue filing is also supported. Tracer does not ship a planning skill.
- Per-repo contract: each project gets an `AGENTS.md` / `WORKFLOW.md` pointer and
  its label mapping via `setup-matt-pocock-skills`.
