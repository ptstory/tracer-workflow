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

Migration target:

```text
chat / PRD / messy idea
  -> Matt Planning: to-tickets@<pinned upstream SHA>
  -> approved GitHub tickets + dependency edges + planning provenance
  -> readiness decision
       -> action-ready: from-issue
       -> needs deeper triage: triage-queue -> Matt Planning: triage
       -> human stop: ready-for-human / needs-info / blocked
  -> PR / review / checks / landing
```

This removes a duplicated planning methodology from Tracer. Matt owns the
engineering method used to turn an idea into vertical slices. Tracer owns the
coordination rules that determine whether the resulting GitHub artifacts are
safe inputs to another actor.

## Authority boundary

The loaded Matt skill is authoritative for its engineering procedure: how to
synthesize a spec, split work into tracer-bullet tickets, ask for approval, or
perform deep triage.

Tracer remains authoritative for workflow semantics that cross actor boundaries:

- the exact GitHub artifact that authorizes the next stage;
- issue and PR identity;
- dependency and slice-contract state;
- HITL / AFK authority;
- current-head SHA identity and stale-evidence handling;
- current remote and CI/check-run state;
- publication success or failure; and
- human-stop and permission boundaries.

If an upstream skill's tracker convention conflicts with a Tracer coordination
invariant, the upstream methodology is preserved but the side effect must be
mapped through the Tracer invariant. Upstream labels are not permission by
syntax alone.

## `to-tickets` replaces `to-issues` as the planning method

`to-issues` should become a legacy name rather than a separately maintained
planning implementation. The canonical planning procedure is Matt's current
`to-tickets` skill, loaded at invocation time.

`to-tickets` contributes:

- context synthesis from the current conversation or referenced issue/spec;
- optional codebase exploration;
- vertical tracer-bullet slices;
- explicit blocking edges;
- a user quiz over ticket granularity and dependencies before publication; and
- issue publication only after approval.

Tracer adds the coordination envelope around that procedure:

- pin one upstream revision per invocation;
- persist enough source provenance to identify the planning procedure that
  produced the durable tickets;
- preserve native GitHub dependency edges where available;
- preserve the Tracer HITL / AFK decision at the planning boundary; and
- do not treat a `ready-for-agent` label as sufficient authorization unless the
  issue satisfies Tracer's execution-input contract.

## Readiness after ticket publication

The important behavioral change is that `agent-brief` is no longer assumed to be
mandatory for every newly planned issue.

A ticket produced by `to-tickets` may go directly to `from-issue` only when its
GitHub record is already a sufficient durable execution input. At minimum that
means the issue identifies the intended slice, acceptance conditions, blocking
edges, and any required upstream contract strongly enough that execution does
not depend on the planning chat.

If that is not true, the ticket is not action-ready even if an upstream procedure
would normally apply a `ready-for-agent` label. It must instead enter deep
triage. This keeps Tracer's rule semantic: readiness is a property of the durable
artifact and current dependency state, not the presence of a label string.

## Triage changes

`triage-queue` and Matt's `triage` solve different scopes and should not be
collapsed prematurely.

- `triage-queue` remains useful as a shallow, repository-wide, read-only selector.
  It answers which item deserves attention next and does not itself make an item
  action-ready.
- `Matt Planning: triage` becomes the preferred upstream method for deep triage
  of one selected issue or PR once its output and Tracer's durable-brief contract
  are proven equivalent in practice.
- `agent-brief` is therefore transitional. It can eventually be retired or
  reduced to a thin Tracer coordination/formatting layer if canonical Matt
  `triage` reliably produces the durable scope, acceptance, and state needed by
  downstream stages.

Until that equivalence is verified, existing `agent-brief` behavior remains the
fallback for the currently implemented workflow.

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
still acts from the ticket, dependency state, current repository state, and
Tracer gates.

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

1. Use `Matt Planning` for `to-tickets` while keeping the existing downstream
   Tracer stages.
2. Add durable planning provenance and validate readiness semantics on real
   tickets.
3. Route non-action-ready tickets through the existing triage path.
4. Trial `Matt Planning: triage` against the same issues and compare its durable
   output with `agent-brief` requirements.
5. Retire duplicated `to-issues` behavior once the new planning path is proven.
6. Reduce or retire `agent-brief` only after the deep-triage contract is proven
   equivalent.
7. Treat review-method migration as a separate change.

The intended endpoint is a thinner Tracer: upstream skills own reusable
engineering methodology; Tracer owns identity, authority, freshness, transport,
and durable coordination between independent actors.
