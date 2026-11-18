# Handoff shape

What `from-pr-review` emits at the end. The point is that the gate result is
**data**, not prose — so you (or the next agent) can act on it without re-reading
a narrative.

```
PR: owner/repo#N
head SHA (before → after): <old> → <new>
base: main

Disposition ledger:
  thread <id> | <file/area> | finding: <reviewer's wording> | severity: <reviewer severity> | disposition: fix-now        | reasoning: <one line> | done: <commit sha>
  thread <id> | <file/area> | finding: <reviewer's wording> | severity: <reviewer severity> | disposition: follow-up-issue | reasoning: <one line> | issue: #M
  thread <id> | <file/area> | finding: <reviewer's wording> | severity: <reviewer severity> | disposition: defer          | reasoning: <one line> | left open: <reason>
  thread <id> | <file/area> | finding: <reviewer's wording> | severity: <reviewer severity> | disposition: reject         | reasoning: <one line> | reply posted
  thread <id> | <file/area> | finding: <reviewer's wording> | severity: <reviewer severity> | disposition: needs-human    | reasoning: <one line> | handed back

Local evidence (bundle, not a readiness claim):
  <cmd> → <result>
  <cmd> → <result>

Check-run gate (head SHA <new>):
  <check name> : <success|failure|pending|neutral>
  <check name> : <success|failure|pending|neutral>
  required-all-green: <true|false>
  Readiness evidence path: <available|plan-unavailable|indeterminate>

Follow-up issues created: [#M, ...] or none

Readiness: ready
   — OR —
Readiness: blocked-on: <red/pending check names> and/or <open deferrals>

Next action: <one fresh-session invocation or `nothing — done`>
```

## Rules for the readiness line

- `ready` is permitted **only** when `required-all-green: true` for the *after*
  SHA and there are no open fix-now items.
- Open defers and `follow-up-issue` items do not block `ready` on their own (they were a verdict, not a
  failure) — but they are listed so the merge decision sees them.
- Never emit "looks good", "LGTM", or any prose in place of the gate result.
- If checks never settle (still pending after the poll budget), readiness is
  `blocked-on: checks pending` — not `ready`, not a guess.
- State the canonical readiness evidence path as `available`, `plan-unavailable`,
  or `indeterminate`, following `skills/review-gate/references/verdict-contract.md`.
  `plan-unavailable` is not by itself a blocker when the contract's exact evidence
  conditions hold; `indeterminate` readiness is blocked.
- Poll actual checks for the after SHA every 30 seconds, up to 20 polls, re-reading
  the PR head each time. Restart verification if the head changes. A failure caused
  by this pass is repaired in the same pass before polling the resulting head again.
- After a push, use a fresh-session Review Gate action. If no push occurred, no new
  disposition or PR-body change was made, and no other action remains, do not trigger
  a duplicate review at the unchanged head. Never emit `from-pr-review` as its own
  next action. If the unchanged head has newly dispositioned findings and no
  `fix-now` rows remain, hand back to `@review-gate <PR_URL>`.

## Regression fixtures

### No push after disposition

```handoff
head SHA (before → after): aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa → aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
Readiness: blocked-on: current-head needs-fix verdict awaits independent review
Next action: @review-gate <PR_URL>
```

### No push and no new PR state

```handoff
head SHA (before → after): aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa → aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
Readiness: blocked-on: current-head needs-fix verdict; no new PR state to review
Next action: nothing — done
```

### Checks still pending after poll budget

```handoff
Check-run gate (head SHA bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb):
  CI : pending
  required-all-green: false
Readiness: blocked-on: checks pending
Next action: gh pr checks 123
```

### Red check caused by this pass

```handoff
Check-run gate (head SHA cccccccccccccccccccccccccccccccccccccccc):
  CI : failure
Action: repaired the in-scope failure in this pass, pushed a correction, and restarted current-head verification
Next action: @review-gate <PR_URL>
```

### Plan unavailable, canonical no-required-check path

```handoff
Check-run gate (head SHA dddddddddddddddddddddddddddddddddddddddd):
  CI : success
  required-all-green: true
  Readiness evidence path: plan-unavailable
Readiness: ready
```
