# Matt Planning integration

Status: migration target. This document defines how the `Matt Planning` Custom GPT
fits into Tracer without making ChatGPT itself a durable workflow authority.
`WORKFLOW.md` remains the description of the currently implemented chain until
individual stages are migrated and verified.

## Decision

`Matt Planning` is the planning-plane runtime for Matt Pocock's canonical
engineering skills. It is not a new coordination plane and it does not replace
GitHub as Tracer's source of truth.

For every named Matt skill invocation, `Matt Planning`:

1. resolves `mattpocock/skills` `main` to an exact commit SHA;
2. pins that SHA for the entire invocation;
3. loads the requested canonical `SKILL.md` and required relative references from
   that same revision;
4. loads nested Matt skills from that same revision;
5. executes the loaded procedure against the current planning conversation and
   GitHub state; and
6. fails explicitly rather than reconstructing a skill from model memory when
   canonical source cannot be loaded.

The Custom GPT session remains disposable. Any result that authorizes later work
must still be persisted to GitHub.

## Vocabulary policy

Prefer Matt's canonical vocabulary whenever Tracer and Matt mean the same thing.
Do not maintain a Tracer synonym merely because the older workflow used one.
Tracer-specific vocabulary should exist only for semantics that Matt's skills do
not define.

Examples:

- planned work produced by `to-tickets` is a **ticket**;
- relationships declared by `to-tickets` are **blocking edges**;
- `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and
  `wontfix` are the canonical **triage roles** unless a repository maps those
  roles to different label strings;
- `CONTEXT.md` is the domain glossary; hard-to-reverse, surprising trade-off
  decisions belong in ADRs rather than being mixed into that glossary; and
- the configured GitHub Issues instance is the repository's **issue tracker**.

Tracer keeps its own terms where the semantics are additional coordination
constraints: durable artifact/record, execution-input admission, evidence bundle,
head-SHA freshness, check-run gate, publication state, HITL/AFK authority, and
coordination plane.

The rule is semantic, not branding: if the concepts are equivalent, use Matt's
word. If Tracer adds a distinct invariant, give that invariant its own name rather
than overloading Matt's term.

## What changes in the Tracer chain

The planning boundary changes from a locally adopted `to-issues` stage to a
source-pinned upstream procedure executed by `Matt Planning`.

Current chain:

```text
chat / PRD / messy idea
  -> to-issues
  -> triage-queue
  -> agent-brief
  -> next
  -> from-issue
  -> PR / review / checks / landing
```

Migration target for work planned by us:

```text
chat / PRD / messy idea
  -> Matt Planning: to-spec (when the effort needs a durable spec)
  -> Matt Planning: to-tickets@<pinned upstream SHA>
  -> approved GitHub tickets + native blocking edges + planning provenance
  -> Tracer execution-input admission
       -> admissible: from-issue
       -> planning artifact insufficient: return to planning / human clarification
       -> blocked or human-owned decision: stop durably
  -> PR / review / checks / landing
```

Incoming issue/PR path:

```text
raw incoming issue / PR
  -> triage-queue (optional shallow repository-wide selector)
  -> Matt Planning or local harness: triage
  -> canonical triage role + durable issue state
  -> Tracer execution-input admission when the result is ready-for-agent
  -> from-issue or human stop
```

This distinction is important: Matt's canonical `triage` is for raw incoming
issues and requests. Tickets created by `to-tickets` are already the output of the
planning flow and should not be sent through `triage` again. If Tracer rejects one
of those tickets at an actor boundary, that is an execution-admission failure or
planning defect, not a second triage pass.

This removes duplicated planning methodology from Tracer. Matt owns the
engineering method used to turn an idea into vertical slices. Tracer owns the
coordination rules that determine whether the resulting GitHub artifacts are
safe inputs to another actor.

## Authority boundary

The loaded Matt skill is authoritative for its engineering procedure: how to
sharpen an idea, synthesize a spec, split work into tracer-bullet tickets, declare
blocking edges, ask for approval, or triage an incoming issue.

Tracer remains authoritative for workflow semantics that cross actor boundaries:

- the exact GitHub artifact that authorizes the next stage;
- issue, PR, and commit identity;
- slice-contract state when a downstream ticket consumes an upstream contract;
- HITL / AFK authority;
- current-head SHA identity and stale-evidence handling;
- current remote and CI/check-run state;
- publication success or failure; and
- human-stop and permission boundaries.

If an upstream skill's tracker convention conflicts with a Tracer coordination
invariant, preserve the upstream engineering methodology and constrain only the
cross-boundary side effect. A label string is routing metadata; it is not by
itself proof that Tracer's downstream admission checks have passed.

## `to-tickets` replaces `to-issues` as the planning method

`to-issues` should become a legacy alias or migration shim rather than a
separately maintained planning implementation. The canonical planning procedure
is Matt's current `to-tickets` skill, loaded at invocation time.

`to-tickets` contributes:

- context synthesis from the current conversation or referenced issue/spec;
- optional codebase exploration;
- vertical tracer-bullet slices;
- explicit blocking edges;
- a user quiz over ticket granularity and dependencies before publication; and
- issue publication only after approval.

Tracer adds only the coordination envelope around that procedure:

- pin one upstream revision per invocation;
- persist enough source provenance to identify the planning procedure that
  produced the durable tickets;
- preserve native GitHub blocking edges where available;
- preserve the Tracer HITL / AFK decision where that authority is required; and
- validate the durable artifact at the handoff to execution rather than rerunning
  the planning or triage methodology.

## Execution-input admission after ticket publication

The old chain assumed `agent-brief` would sit between planning and implementation.
That assumption should not survive merely as ceremony.

A ticket produced by `to-tickets` is already intended to be agent-ready in Matt's
flow. Tracer's additional check is narrower: at the moment another independent
actor is about to execute it, verify the durable GitHub artifact and current
external state are sufficient for that handoff.

That admission check asks coordination questions, not planning questions:

- Is this the intended ticket and repository?
- Are its blocking edges currently satisfied?
- If it consumes an upstream slice contract, is that contract present and strong
  enough for the downstream work?
- Is the relevant HITL/AFK authority known?
- Does the durable GitHub record contain the information the execution actor must
  have without relying on the planning chat?
- Has any external state changed in a way that invalidates the handoff?

If the answer is yes, proceed to `from-issue` without an obligatory `agent-brief`
rewrite. If the answer is no, return the artifact to the appropriate producer or
stop for the missing human decision. Do not call this `triage` unless the item is
actually an incoming issue being processed by Matt's triage flow.

## Triage changes

`triage-queue` and Matt's `triage` solve different scopes and can coexist while
Tracer is being thinned:

- `triage-queue` is a shallow, repository-wide, read-only selector. It answers
  which raw or stale item deserves attention next and changes nothing on GitHub.
- Matt's `triage` is the canonical deep procedure for one incoming issue or PR.
- Tickets produced by `to-tickets` skip Matt `triage`; they proceed to the
  execution-input admission boundary.

`agent-brief` is therefore transitional. For incoming items, it can eventually be
retired or reduced to a thin Tracer coordination adapter if Matt `triage`
reliably produces the durable state downstream actors need. For `to-tickets`
output, it should not remain mandatory unless testing reveals a specific
coordination gap that the upstream ticket does not cover.

## Durable provenance

A provenance line printed only in the Custom GPT response is insufficient because
chat is disposable. When `Matt Planning` publishes or materially mutates a
GitHub planning artifact, the durable artifact should carry planning provenance
such as:

```text
Planning method: mattpocock/skills to-tickets@3cca18b
Skill blob: e868c831fcfb1e124e010bcdf84a429ec879160f
```

The exact commit and blob values are invocation-specific. They must come from the
actual GitHub source load for that invocation, never from a remembered or static
value.

This provenance records methodology, not execution authority. A later worker
still acts from the ticket, blocking-edge state, current repository state, and
Tracer gates.

## Local alignment pass on tracer-workflow

Run Matt's skills locally against `tracer-workflow` instead of trying to predict
all integration differences from documentation alone.

Recommended order:

1. **`setup-matt-pocock-skills`** — let it inspect the repository and propose the
   issue-tracker, triage-role, and domain-doc configuration Matt's other skills
   expect. Review its proposed edits before writing them. Prefer adapting Tracer
   to the canonical layout where there is no real semantic conflict.
2. **`domain-modeling`** — audit `CONTEXT.md` for duplicate, fuzzy, or overloaded
   terms. Replace Tracer synonyms with Matt vocabulary where they mean the same
   thing; retain Tracer terms only for genuinely additional coordination
   concepts. Keep `CONTEXT.md` a glossary rather than an implementation spec.
3. **`writing-for-agents`** — review the agent-facing entry points after the
   vocabulary settles so `AGENTS.md` and pointed-at docs describe the same model
   that the local skills consume.
4. Exercise **`to-spec` / `to-tickets`** on a real Tracer change and compare the
   resulting durable tickets with what `from-issue` actually needs. Record
   concrete gaps rather than preserving old stages preemptively.
5. Exercise **`triage`** on a genuinely incoming/raw issue, not on a ticket that
   `to-tickets` created, and compare its durable output with the remaining useful
   parts of `agent-brief`.

This local pass is allowed to change Tracer's documentation vocabulary and
configuration. It is not allowed to silently weaken Tracer's cross-actor
identity, freshness, permission, or evidence invariants merely to make the repo
look more like upstream.

## What does not change

This integration does not make ChatGPT memory durable, does not make the Custom
GPT an authority over GitHub, and does not weaken the existing execution or
review boundaries.

In particular:

- `from-issue` still consumes a durable GitHub execution input and produces a PR
  plus evidence;
- the slice-contract rule still blocks downstream work when an upstream contract
  is absent, ambiguous, or stale;
- review remains independent of the planning conversation;
- a review result is still bound to an exact PR head SHA;
- current-head CI/check state still outranks narrated confidence; and
- HITL / AFK still controls landing authority rather than being inferred by an
  implementation worker.

Matt's `code-review` may later supply more of the engineering review methodology,
but that is a separate migration. Tracer still needs an independent evaluator
for SHA freshness, publication state, CI/check state, permissions, and human
stops, so this planning integration does not replace the review gate by itself.

## Migration sequence

1. Run the local alignment pass so Tracer's issue-tracker configuration, domain
   vocabulary, and agent-facing docs stop fighting Matt's conventions.
2. Use `Matt Planning` for `to-spec` / `to-tickets` while keeping the existing
   downstream Tracer execution and review stages.
3. Add durable planning provenance and validate execution-input admission on real
   tickets.
4. Remove mandatory `agent-brief` from the `to-tickets` path unless a concrete
   missing coordination contract is demonstrated.
5. Trial Matt `triage` on incoming issues and reduce or retire the overlapping
   deep-triage behavior in `agent-brief` when equivalence is demonstrated.
6. Retire `to-issues` as a separately maintained planning implementation; keep at
   most a compatibility alias/shim if needed during migration.
7. Treat review-method migration as a separate change.

The intended endpoint is a thinner Tracer: upstream skills own reusable
engineering methodology and vocabulary; Tracer owns identity, authority,
freshness, transport, and durable coordination between independent actors.
