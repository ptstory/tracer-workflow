# CONTEXT.md

Glossary for tracer-workflow. Terms only — no steps, no rules, no file layout.
Doctrine lives in WORKFLOW.md.

Current label names are read from `gh label list`, never from this file. What a
label *means* is defined here; which labels exist is a property of the repo.

## Plane

Where a stage runs. Three of them: the **planning plane** (ChatGPT/Claude web),
the **execution plane** (OpenCode), and the **coordination plane** (GitHub).
Only the coordination plane is durable. A stage may move between the other two
without changing the workflow, because every stage reads and writes GitHub
artifacts rather than session state.

## GitHub label

A mutable tag on an issue or PR, carrying queue state. Applied by a human or by a
triage stage after a durable brief exists. Labels are the workflow's routing
state, and they are read from GitHub, never from a document.

## Verdict value

A string inside a review-gate verdict comment, naming the outcome of one review
at one head SHA. A verdict value is not a label: it lives in comment text, it is
written by the review stage, and it goes stale when the head moves. Where a
verdict value and a label share a word, they are still different objects — the
`gate:` prefix marks the labels that mirror a verdict.

Each verdict also carries a review round, so the same verdict value means one
review outcome at one head SHA in one numbered round.

The authoritative verdict vocabulary is
`skills/review-gate/references/verdict-contract.md`.

## Evidence bundle

The body of a from-issue PR: exact commands run and their literal output,
anchored to a specific head SHA. Prose claims about the work are an index to the
bundle, not the bundle. The bundle is the artifact review audits.

## Head SHA / SHA-staleness

Every review verdict is valid only against the commit it reviewed. Pushing moves
the head SHA and invalidates the verdict by construction — not by anyone
noticing. This is why a fix pass that runs against a stale verdict correctly does
nothing.

## Check-run gate

Merge readiness read from actual check-run state at the current head, never from
a report that tests passed. A pending or red required check means not ready,
independent of diff quality. Review-gate findings that can block that merge
decision are limited by the binding scope defined in the verdict contract: the
issue body plus brief clarifications explicitly marked as derived from it.

## Slice contract

What a downstream issue consumes from its upstream blocker: the exact data, API,
behavior, or file boundary. A closed blocker does not by itself satisfy the
contract. Missing, ambiguous, or stale contract means stop and request it.

## Queue recommendation vs deep-triage decision

A **queue recommendation** is the output of a shallow repository-wide pass. It
suggests how an item should move and changes nothing on GitHub. A **deep-triage
decision** is the output of reading one item closely, and it is what makes a
durable label safe to apply. A recommendation is never action-ready on its own.

## Durable brief

The GitHub comment produced by deep triage, containing the context, scope
boundaries, and acceptance criteria an agent needs to execute without chat
memory. Its existence is what a ready-for-agent label asserts.

## HITL / AFK

The autonomy call, made at issue creation in the planning plane with full
context, never inferred mid-session by a worker. **AFK** pre-authorizes the
autonomous path through merge once the check-run gate is green. **HITL** means
the human owns the merge button; agents may still push fixes, reply to threads,
and report a green gate.

## Custom vs adopted

**Custom** stages are authored here and this repo is their canonical source.
**Adopted** stages are upstream copies, consumed as-is — extended through a
config seam or routed around, never edited in place.
