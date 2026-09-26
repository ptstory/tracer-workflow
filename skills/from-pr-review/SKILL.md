---
name: from-pr-review
description: >
  Process code-review feedback on an existing GitHub PR: read the review
  threads, apply the fixes approved under references/disposition-rules.md, verify against
  real check-runs for the new head SHA, reply to each thread, re-push, and emit a
  handoff. This is the mechanical return leg of the review loop. It does NOT
  decide whether feedback is valid without following
  references/disposition-rules.md. Use after a reviewer (requesting-code-review, ChatGPT,
  or human) has left feedback on a PR that needs to be addressed.
---

# from-pr-review

Plumbing for the review return leg. `references/disposition-rules.md` is the brain; this is
the hands. Never decide whether a review item is good — collect the items,
apply `references/disposition-rules.md` to each, execute its verdict, prove the result
against actual check-run state, and hand back.

## Inputs

- Resolve the PR in order: (a) use an explicit PR URL or number; (b) if absent,
  run `gh pr view --json number,url,headRefName,headRefOid` for the current branch;
  (c) if neither resolves, list open PRs labeled `gate:needs-fix` and stop,
  printing the exact rerun command `from-pr-review <PR_URL>` for the selected PR.
  Do not choose a PR from the list automatically. The first output line must
  state `owner/repo#N`, the head SHA, and the resolution path used (`explicit`
  or `current branch`). If unresolved, the first output line must state that
  PR resolution failed and the path attempted; never invent an identity or SHA.

## Boundaries

- **Never merge.** Report gate state; merging is a separate, gated decision (see
  the check-run gate and HITL/AFK rules in `WORKFLOW.md`). HITL issues: human
  merges. AFK issues: merge is a distinct step outside this skill.
- **Never resolve a thread you did not act on.** A reply that says "fixed" must
  correspond to a pushed change or an explicit deferral verdict under
  `references/disposition-rules.md`.
- **Never assert readiness from reported output.** Readiness comes from check-run
  state for the head SHA you just pushed, read via `gh`/API. A local "tests pass"
  is evidence for the bundle, not a readiness verdict.
- Do not open follow-up issues silently — only when `references/disposition-rules.md`
  yields a `follow-up-issue` verdict, and record the created issue number in the
  handoff.
- Start a new fixer session for each `needs-fix` round, never the session that
  implemented the PR. Read round state from GitHub verdict comments and blocking
  sets rather than session context.
- Uncommitted or unpushed changes are never a valid terminal state. If a blocker
  is within this skill's own steps, perform that step instead of reporting it as
  blocked. If an external prerequisite cannot be satisfied, report the exact
  blocker without claiming the pass is complete.

## Steps

1. **Identify the PR.** Resolve URL/number to `owner/repo#N`, the head branch, and
   the current head SHA. Record the base branch.

2. **Checkout the branch.** Use the project's worktree convention (see the repo's
   `AGENTS.md`; default to a worktree, not a raw checkout, if the repo says so).
   Confirm the working tree is clean before touching anything.

3. **Build the review-thread ledger.** Pull every unresolved review thread and
   review comment via `gh pr view <N> --json reviews,comments` plus the
   review-thread GraphQL query (REST does not expose thread resolution state —
   see `references/gh-review-threads.md`). One ledger row per actionable item:
   thread id, file/area, the reviewer's ask, current state. Before building the
   ledger, read `review-round:` from the latest verdict comment and apply the
   round-aware rules in
   `skills/review-gate/references/verdict-contract.md`. Read this file from the repo
   when running inside tracer-workflow; otherwise fetch it with
   `gh api repos/ptstory/tracer-workflow/contents/skills/review-gate/references/verdict-contract.md -H "Accept: application/vnd.github.raw"`.
   If neither works, stop; never proceed without the contract. On `needs-human`, stop
   and hand back; do not run a fix pass at any SHA. On round `N > 0`, apply the
   contract's stale-finding rule and its correctness/security exception.
   Non-actionable chatter is marked and skipped, not dropped.

4. **Delegate judgment and record the disposition ledger.** For each ledger row,
   apply `references/disposition-rules.md` and record the returned disposition
   ledger entry before any fix work begins. Each row must preserve the finding as
   the reviewer stated it, the severity the reviewer assigned, the returned
   disposition, and one line of reasoning for that disposition. Reviewer severity
   is input to judgment, not the judgment itself; a reviewer-marked fix-now may
   come back `follow-up-issue`. Use the canonical disposition vocabulary from
   `skills/review-gate/references/verdict-contract.md`: `fix-now`,
   `follow-up-issue`, `defer`, `reject`, `needs-human`. Read this file from the repo
   when running inside tracer-workflow; otherwise fetch it with
   `gh api repos/ptstory/tracer-workflow/contents/skills/review-gate/references/verdict-contract.md -H "Accept: application/vnd.github.raw"`.
   If neither works, stop; never proceed without the contract. Do not override the
   returned disposition. Do not add "good catch" framing — `references/disposition-rules.md`
   forbids it and so does this skill.

5. **Plan the minimal response pass.** Build the fixer batch ONLY from rows whose
   returned disposition is `fix-now`. Every other row is excluded from the batch
   and carried through to the reply and handoff. Passing review findings straight
   to a fixer without a returned disposition per row is a contract violation; this
   is the observed failure mode. Do not expand scope beyond what the
   dispositions authorize.

6. **Apply fixes.** Implement only the `fix-now` rows in the fixer batch. Keep
   each change traceable to its ledger row (which thread it answers).

7. **Verify locally.** Run the repo's test/build/lint commands. Capture exact
   command + output for the evidence bundle. This is evidence, not a readiness
   claim — see step 9.

8. **Commit and push.** One commit per coherent group, message referencing the
   thread(s) it resolves. Push to the same head branch. Capture the **new** head
   SHA.

9. **Verify against real check-runs (the gate).** For the new head SHA, poll
   actual check-run state — `gh pr checks <N>` or the GitHub checks API — until
   checks settle (not pending). Record per-check conclusion. Readiness follows
   the current head's required status-check configuration: if required checks
   are configured, all applicable required checks must be green at the current
   head and at least one applicable required check must exercise the changed
   paths; if no required checks are configured, at least one green CI/check run
   on the current head must exercise the changed paths. Older-head results never
   count. A green local run in step 7 does not satisfy this; a reported "tests
   pass" never does. See `WORKFLOW.md` → check-run gate.

10. **Reply to review threads.** For each ledger row, post a threaded reply that
    states what was done (commit SHA) or the returned disposition and its issue
    number / reason. Resolve threads that are genuinely resolved. Leave open the
    ones the verdict said to defer, with the reason.

11. **Handoff.** Emit a structured handoff (see `references/handoff-shape.md`):
    PR, new head SHA, the disposition ledger from step 4, check-run gate result as data,
    any follow-up issues created, and the single readiness line — **ready** only
    if the gate is green, otherwise **blocked-on:** with the specific red/pending
    checks or open deferrals. Never "looks good" prose in place of the gate
    result. Every report, including blocked and unresolved-PR reports, ends
    with `Next action:` followed by one copy-pasteable command or invocation,
    or `nothing — done` when no action remains. For a pushed fix, name the
    fresh-session `review-gate <PR_URL>` invocation; never instruct a merge
    from this skill.

## Do not

- Do not decide feedback validity — that follows `references/disposition-rules.md`.
- Do not merge.
- Do not claim readiness off local or reported output.
- Do not resolve threads you did not address.
- Do not send review findings to a fixer without a returned disposition per row.
- Do not use non-canonical disposition scope-creep language; use the contract's
  disposition vocabulary.
- Do not rewrite or delete existing code or comments beyond what a fix-now verdict
  requires.
