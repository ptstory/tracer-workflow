# review-gate verdict contract

The contract between the reviewer (fresh web session) and the actor that reads the
verdict (the poller → OpenCode fix pass). GitHub is the bus; this is the message
format on it.

## Marker

A gate verdict is a PR comment whose body starts with:

```
## review-gate: <state>
```

`<state>` ∈ `merge-candidate | needs-fix | needs-human | blocked`. Any PR comment
without this exact prefix is not a verdict and is ignored.

## SHA-staleness rule (load-bearing)

The comment carries a `head-sha:` line. A verdict is valid **only** while that SHA
equals the PR's current head. The moment anyone pushes, every prior verdict is
void — its SHA no longer matches head.

The reader (poller) MUST compare `head-sha` in the latest verdict against
`gh pr view <n> --json headRefOid`. Mismatch → treat as no valid verdict, do
nothing. This is what prevents acting on a `merge-candidate` that was true three
commits ago.

## Comment-only, no ref mutation

The reviewer posts comments. It never pushes, merges, edits refs, or changes
labels. GitHub blocks a formal REQUEST_CHANGES review on a self-authored PR anyway,
so the state lives in comment text, not in `reviewDecision`. Do not read
`gh pr view --json reviewDecision` for the verdict — read the comment body.

## Dispositions

Each finding carries a `receiving-code-review` class:

- `fix-now` — must be addressed before merge. Any open `fix-now` blocks
  `merge-candidate`.
- `defer` — real but not blocking; left open with a reason.
- `follow-up-issue` — spun into a new issue; record the number.
- `reject` — reviewer pushed back with evidence; no action.
- `needs-human` — judgment/scope/product call the agent must not make alone.

## What the reader does per state

- `merge-candidate` + SHA current → eligible to merge (human still owns the button
  for HITL issues; see WORKFLOW.md).
- `needs-fix` + SHA current → run the fix pass on `fix-now` findings via
  `receiving-code-review`, push, which invalidates this verdict (new SHA) and
  triggers a fresh review.
- `needs-human` → stop, surface to Perry.
- `blocked` → stop, surface the blocker.
- SHA stale (any state) → do nothing; wait for a verdict on current head.
