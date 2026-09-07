# agent-brief prompt

Paste into a ChatGPT/Claude web session with GitHub connector access. Replace
`<ISSUE_OR_PR_URL>`.

This is a plain reusable prompt, not an auto-triggered skill or slash command.
GitHub is the source of truth: read the issue or PR body, comments, labels,
linked context, and repository workflow docs before writing the brief.

Session and continuation behavior follows [`CONTINUATION.md`](../CONTINUATION.md).
If this is the first unique item selected by the immediately preceding
`triage-queue` pass, it may continue in that same triage conversation. Otherwise
start fresh for a different artifact.

---

Prepare a durable agent brief for `<ISSUE_OR_PR_URL>`.

The authoritative execution input may be one of three validated sources: a GitHub
issue URL/number with its durable ready-for-agent brief, a complete pasted
implementation handoff, or a pasted durable agent brief. Once validated, treat
it as equivalent execution input.

For a GitHub issue, the brief specifies what an AFK agent should build from the
issue. This is the durable execution input consumed by `from-issue` once the
issue is labeled `ready-for-agent`; chat history is not required after the
brief is posted.

For a GitHub PR, the brief specifies what remains to do on the existing diff:
finish it, close gaps, address review points, or stop for human judgment. PR
briefs are for maintainer/human coordination unless a downstream workflow is
explicitly wired to consume them.

If the execution path needs brainstorming, planning, or `using-superpowers` help,
that help is subordinate to `from-issue`: once action-ready input is accepted,
those steps must return control to execution. A generic `Approve this direction`
or design-approval checkpoint does not end the run unless it names a concrete
unresolved blocker that is absent from the issue or brief.
Multi-file scope, UI impact, a desire for planning, or a nested skill's default
approval checkpoint are not blockers by themselves.

The allowed terminal outcomes are: PR opened with closing issue reference +
evidence bundle; existing PR/worktree resumed and advanced; explicit durable
blocker naming the exact missing prerequisite or decision; verified failure with
the exact recovery state persisted.

Do this:

1. Read the full issue or PR. For a PR, also read the diff and relevant review
   discussion.
2. Determine whether this is a `bug` or `enhancement`.
3. Recommend the target state: `ready-for-agent`, `ready-for-human`,
   `needs-info`, or `wontfix`.
4. For `ready-for-agent`, write a durable agent brief that `from-issue` can
   execute without chat-memory context.
5. For `ready-for-human`, write the same structure, but explain why it cannot
   safely be delegated.
6. For `needs-info`, write specific questions, not vague "please provide more
   info" requests.
7. For `wontfix`, explain the reason and apply the out-of-scope rules below.
8. If the durable brief/triage comment is successfully posted, create or update
   the artifact's single `<!-- tracer-continuation:v1 -->` comment rather than
   appending competing pointers. Map non-terminal outcomes to the canonical
   fields explicitly:
   - `ready-for-agent` issue → `stage: implementation`, `surface: OpenCode`,
     `session-policy: fresh-required`, `next-action: from-issue <exact issue URL>`.
     Do not invent a session locator; `from-issue` may add a safe implementation
     locator once an implementation lane actually exists.
   - `ready-for-human` → `stage: triage`, `surface: GitHub`,
     `session-policy: n/a`, `next-action: Open <exact artifact URL> and make the
     single human decision named in the Agent Brief's Delegation note.`
   - `needs-info` → `stage: triage`, `surface: GitHub`, `session-policy: n/a`,
     `next-action: Open <exact artifact URL> and answer the specific questions
     under "What we still need from you" in the latest Triage Notes.`
   - `wontfix` is terminal and has no next transition, so do **not** create or
     refresh an active continuation pointer. If an active marked pointer already
     exists for the artifact, delete it or update that comment to remove the
     `<!-- tracer-continuation:v1 -->` marker so no active route remains.
   Use `as-of` and `source-class` from the canonical pointer contract for every
   pointer that is written.
9. If the brief post succeeds but pointer publication or retirement fails,
   report that failure separately. Do not claim the pointer changed and do not
   treat the successfully posted brief as absent.

Durability rules:

- Write behavioral contracts, not implementation steps.
- Describe interfaces, types, command behavior, data shapes, and observable
  behavior.
- Include independently testable acceptance criteria.
- State explicit scope boundaries.
- Surface assumptions and uncertainty.
- Do not rely on chat history.
- Do not reference stale line numbers.
- Do not prescribe exact files unless the file itself is the contract.
- Do not gold-plate adjacent features.
- A continuation pointer is routing metadata only; it never outranks the issue,
  PR, current head SHA, labels, blockers, or review/check state.

Out-of-scope rules:

- Do not write `.out-of-scope/` for already-implemented behavior.
- Only rejected enhancements go into `.out-of-scope/`.
- Bugs rejected as invalid do not create `.out-of-scope/` records.

If posting to GitHub, every triage or brief comment must start with:

```
> *This was generated by AI during triage.*
```

For `ready-for-agent` or `ready-for-human`, use this format:

```markdown
> *This was generated by AI during triage.*

## Agent Brief

**Category:** bug / enhancement

**Summary:** one-line description of what needs to happen

**Current behavior:**
Describe what happens now. For a PR, describe the current state of the diff and
what remains incomplete.

**Desired behavior:**
Describe what should happen after the work is complete. Include edge cases and
error conditions.

**Key interfaces:**
- `TypeName` — what needs to change and why
- `functionName()` — current behavior vs desired behavior
- Config/data/API shape — any contract the agent must preserve or introduce

**Acceptance criteria:**
- [ ] Specific, independently testable criterion
- [ ] Specific, independently testable criterion
- [ ] Specific, independently testable criterion

**Out of scope:**
- Thing that should not be changed
- Adjacent feature that might seem related but is separate

**Delegation note:**
State `AFK-safe` or `needs human`, with the reason.
```

For `needs-info`, use this format:

```markdown
> *This was generated by AI during triage.*

## Triage Notes

**What we've established so far:**

- point 1
- point 2

**What we still need from you (@reporter):**

- specific question 1
- specific question 2
```

For `wontfix`, use this format:

```markdown
> *This was generated by AI during triage.*

## Triage Notes

**Decision:** wontfix

**Reason:**
Explain why this will not be actioned.

**Out-of-scope record:**
Say whether `.out-of-scope/` should be created, updated, or not touched.
```

If you cannot post the GitHub comment, output the comment body and say it was not
posted. Do not create or claim a continuation pointer for a brief that was not
durably posted.
