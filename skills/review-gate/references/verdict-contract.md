# review-gate verdict contract

The contract between the review writer (fresh web session) and the readers of the
verdict (the poller and any automated fix pass). GitHub is the bus; this file is
the canonical message contract on it.

## Verdict marker and required fields

A gate verdict is a PR comment whose body starts with:

```
## review-gate: <state>
```

`<state>` ∈ `merge-candidate | needs-fix | needs-human | blocked`. Any PR comment
without this exact prefix is not a verdict and is ignored.

Required fields immediately below the marker:

- `head-sha:` — full 40-character commit SHA
- `review-round:` — integer, 0-based
- `reviewed-files:` — integer

A comment missing any required field is not a verdict and readers ignore it.

## Comment-only, no ref mutation

The reviewer posts comments. It never pushes, merges, edits refs, or changes
labels. GitHub blocks a formal REQUEST_CHANGES review on a self-authored PR anyway,
so the state lives in comment text, not in `reviewDecision`. Do not read
`gh pr view --json reviewDecision` for the verdict — read the comment body.

## SHA-staleness rule (load-bearing)

The comment carries a `head-sha:` line. A verdict is valid **only** while that SHA
equals the PR's current head. The moment anyone pushes, every prior verdict is
void — its SHA no longer matches head.

The reader MUST compare `head-sha` in the latest verdict against
`gh pr view <n> --json headRefOid`. Mismatch → treat as no valid verdict, do
nothing. This is what prevents acting on a `merge-candidate` that was true three
commits ago.

## Binding scope

The binding contract for a PR is:

1. the originating issue body, plus
2. any clarification in the durable agent brief that is explicitly marked as
   derived from the issue body.

Requirements that first appear in the agent brief and are not marked as derived
are non-binding. The reviewer may report them, but they cannot carry `fix-now`
and cannot block merge.

If the issue body and the brief genuinely contradict each other — as opposed to
the brief merely adding — the verdict is `needs-human` for contract
reconciliation. The reviewer does not resolve that contradiction by choosing the
larger scope.

## Review rounds

Round 0 is the first review of a PR: full review against the binding contract.

Round `N > 0` reviews:

- the previously reported blocking findings,
- the diff since the previously reviewed head SHA,
- regressions introduced by that diff, and
- anything in the binding contract the diff newly violates.

Derive `review-round` as follows:

- `review-round` equals the number of prior conforming verdict comments on the
  PR — comments carrying the marker and all required fields.
- The first review of a PR therefore emits `review-round: 0`.
- Non-conforming comments (missing marker or any required field) are not
  verdicts and do not increment the round.
- Review responses, disposition comments, and any other PR comment do not
  increment the round.
- If the count cannot be determined, the reviewer emits `blocked` rather than
  guessing a round number.

## Verdict states

The verdict state vocabulary is exactly:

- `merge-candidate`
- `needs-fix`
- `needs-human`
- `blocked`

No other verdict state is in contract.

## Finding dispositions

Each finding carries a disposition. The disposition vocabulary is exactly:

- `fix-now` — must be addressed before merge. Any open `fix-now` blocks
  `merge-candidate`.
- `follow-up-issue` — spun into a new issue; record the number.
- `defer` — real but not blocking; left open with a reason.
- `reject` — reviewer pushed back with evidence; no action.
- `needs-human` — judgment/scope/product call the agent must not make alone.

`scope-creep` is **not** a disposition in this contract. Scope-excluded findings
are `follow-up-issue`.

## Stale-finding rule

On round `N > 0`, a finding against code that has not changed since round 0 is
`follow-up-issue`, not `fix-now` — unless it is a correctness or security
regression, which stays `fix-now` at any round.

Rationale: a gate that can raise pre-existing conditions at any round has no
termination condition.

## Circuit breaker

After two corrective rounds, any review at `review-round: 3` or higher yields
`needs-human`.

In that same verdict the reviewer records a disposition for every surviving
finding:

- regressions stay `fix-now` and are named as the human's blocking set;
- everything else becomes `follow-up-issue` with a one-line summary suitable
  for filing.

The breaker never silently waives a finding and never auto-files an issue
itself.

## What the reader does per state

- `merge-candidate` + SHA current → eligible to merge; human still owns the
  button for HITL.
- `needs-fix` + SHA current → run the fix pass on `fix-now` findings via
  `receiving-code-review`; any push invalidates this verdict and requires a
  fresh review.
- `needs-human` → stop. No automatic fix pass may be launched, at any SHA.
- `blocked` → stop, surface the blocker.
- SHA stale (any state) → do nothing; wait for a verdict on current head.

`needs-human` is a hard stop for automated actors.

A reader that cannot parse `review-round:` must treat the verdict as unparseable
and stop rather than defaulting to round 0.

## Consumers

The following consumers must change to conform to this contract:

- `skills/review-gate/PROMPT.md` — emit `review-round:` and apply the round,
  stale-finding, and circuit-breaker rules.
- `skills/from-pr-review/SKILL.md` — require per-item disposition via
  `receiving-code-review` before any fixer batch, and align its disposition
  vocabulary.
- `tooling/review-gate-poller/` — parse `review-round:` and refuse to act on
  `needs-human`.
- `prompts/agent-brief.md` — mark requirements as derived from the issue body vs
  newly discovered.

Do not treat those consumers as conforming until their follow-up PRs land.
