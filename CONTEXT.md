# CONTEXT.md

Glossary for tracer-workflow. This file defines terms. [WORKFLOW.md](./WORKFLOW.md)
contains steps, rules, and file layout.

Current label names come from `gh label list`. This file defines what each label
means; the repository determines which labels exist.

## Plane

Where a stage runs. There are three planes: the **planning plane** (ChatGPT/Claude
web), **execution plane** (OpenCode), and **coordination plane** (GitHub). Only
the coordination plane is durable. A stage may move between the other two
without changing the workflow because every stage reads and writes GitHub
artifacts instead of session state.

## GitHub label

A mutable tag on an issue or PR that carries queue state. A human or triage stage
applies it after a durable brief exists. Labels provide workflow routing state
and are read from GitHub.

## Verdict value

A string inside a review-gate verdict comment naming the outcome of one review at
one head SHA. Verdict values live in comment text and become stale when the head
moves. They are separate from labels even when they share a word; the `gate:`
prefix marks labels that mirror verdict values.

Each verdict also carries a review round, so the same verdict value identifies
one review outcome at one head SHA in one numbered round.

The authoritative verdict vocabulary is
`skills/review-gate/references/verdict-contract.md`.

## Evidence bundle

The body of a `from-issue` PR containing the exact commands run and their literal
output, anchored to a specific head SHA. Prose claims about the work only index
that evidence. Review audits the bundle.

## Head SHA / SHA-staleness

Every review verdict is valid only for the commit it reviewed. Pushing moves the
head SHA, so the verdict becomes stale automatically. A fix pass correctly does
nothing when its verdict targets an older head.

## Check-run gate

Merge readiness comes from actual check-run state at the current head. A pending
or red required check means the PR is not ready, regardless of diff quality or a
report that tests passed. Review-gate findings that can block that merge decision
are limited by the binding scope in the verdict contract: the issue body plus
brief clarifications explicitly marked as derived from it.

## Slice contract

The exact data, API, behavior, or file boundary that a downstream issue consumes
from its upstream blocker. Closing the blocker does not satisfy the contract by
itself. If the contract is missing, ambiguous, or stale, stop and request it.

## Queue recommendation vs deep-triage decision

A **queue recommendation** comes from a shallow repository-wide pass. It suggests
how an item should move and changes nothing on GitHub. A **deep-triage decision**
comes from reading one item closely and makes a durable label safe to apply. A
recommendation alone is not action-ready.

## Durable brief

The GitHub comment produced by deep triage. It contains the context, scope
boundaries, and acceptance criteria an agent needs to execute without chat
memory. A `ready-for-agent` label asserts that this brief exists.

## HITL / AFK

The autonomy decision made at issue creation in the planning plane with full
context. Workers do not infer it mid-session. **AFK** pre-authorizes the
autonomous path through merge once the check-run gate is green. **HITL** means
the human owns the merge button; agents may still push fixes, reply to threads,
and report a green gate.

## Custom vs adopted

**Custom** stages are authored here, and this repo is their canonical source.
**Adopted** stages are upstream copies consumed as-is. They can be extended
through a config seam or routed around, but are never edited in place.
