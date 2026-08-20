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

Follow-up issues created: [#M, ...] or none

Readiness: ready
   — OR —
Readiness: blocked-on: <red/pending check names> and/or <open deferrals>
```

## Rules for the readiness line

- `ready` is permitted **only** when `required-all-green: true` for the *after*
  SHA and there are no open fix-now items.
- Open defers and `follow-up-issue` items do not block `ready` on their own (they were a verdict, not a
  failure) — but they are listed so the merge decision sees them.
- Never emit "looks good", "LGTM", or any prose in place of the gate result.
- If checks never settle (still pending after the poll budget), readiness is
  `blocked-on: checks pending` — not `ready`, not a guess.
