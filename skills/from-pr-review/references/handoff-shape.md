# Handoff shape

What `from-pr-review` emits at the end. The point is that the gate result is
**data**, not prose — so you (or the next agent) can act on it without re-reading
a narrative.

```
PR: owner/repo#N
head SHA (before → after): <old> → <new>
base: main

Disposition:
  thread <id> | <file/area> | ask: <short> | verdict: fix-now      | done: <commit sha>
  thread <id> | <file/area> | ask: <short> | verdict: follow-up    | issue: #M
  thread <id> | <file/area> | ask: <short> | verdict: defer        | left open: <reason>
  thread <id> | <file/area> | ask: <short> | verdict: reject       | reply posted

Local evidence (bundle, not a readiness claim):
  <cmd> → <result>
  <cmd> → <result>

Check-run gate (head SHA <new>):
  <check name> : <success|failure|pending|neutral>
  <check name> : <success|failure|pending|neutral>
  required-all-green: <true|false>

Follow-up issues created: [#M, ...] or none

Readiness: ready
   — OR —
Readiness: blocked-on: <red/pending check names> and/or <open deferrals>
```

## Rules for the readiness line

- `ready` is permitted **only** when `required-all-green: true` for the *after*
  SHA and there are no open fix-now items.
- Open defers do not block `ready` on their own (they were a verdict, not a
  failure) — but they are listed so the merge decision sees them.
- Never emit "looks good", "LGTM", or any prose in place of the gate result.
- If checks never settle (still pending after the poll budget), readiness is
  `blocked-on: checks pending` — not `ready`, not a guess.
