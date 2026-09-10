# visual-proof comment contract

The producer-side `visual-proof` step writes one durable PR comment for the PR
head it inspected. GitHub is the bus; this file defines the comment shape and
the reviewer's interpretation boundary.

## Producer marker and required fields

A conforming producer comment starts with exactly one of:

```text
## visual-proof: provided
```

```text
## visual-proof: n/a
```

Required fields immediately below the marker are:

- `head-sha:` — full 40-character lowercase commit SHA;
- `surface:` — the actual route/component/harness/state rendered, or literal
  `n/a` for an `n/a` producer comment;
- `claim:` — a short statement of exactly what the evidence demonstrates or why
  proof is not applicable at this stage.

The remaining body contains either GitHub-hosted media (`provided`) or a concrete
N/A explanation (`n/a`). A later PR-head change makes the comment stale.

## Scope fidelity

Evidence proves only the level actually implemented.

- Integrated UI work may prove the integrated route/state.
- A standalone component rendered in an existing Storybook, fixture, preview, or
  trivial local harness proves the component only; it does not prove production
  wiring.
- Component/API/markup work with no reasonable render path may use `n/a` when
  demonstrating it would require out-of-scope integration.
- Backend/CLI/internal-only work is normally non-visual and does not acquire a
  screenshot requirement.
- Visual bug fixes should use before/after evidence when practical.
- Responsive work should show only materially affected viewports.
- Interaction/animation should use a short video when a still image cannot prove
  the behavior.

Do not add fake production routes, unrelated wiring, or a general preview system
solely to satisfy this contract.

## GitHub-hosted media

Transient proof media belongs on the PR, not in the repository. With GitHub CLI
v2.99+ the producer may use repeatable `gh pr comment --attach` flags. If the
body references a local media path, `gh` rewrites that reference to the uploaded
GitHub asset; otherwise it appends the uploaded media to the comment.

External screenshot hosts and committed transient proof files are out of
contract. If GitHub upload tooling is unavailable while the work is otherwise
renderable, that is a tooling/evidence blocker, not justification for `n/a`.

## SHA-staleness

`head-sha:` is load-bearing. The reviewer resolves the PR's current head from
GitHub and compares it with the producer comment. Older-head proof never counts
as current evidence, even when the pixels still look plausible.

Any later push requires a new producer comment for the new head before visual
proof can support a merge-candidate verdict.

## Reviewer classification

The producer state is not the review result. The fresh `review-gate` session
independently emits one of these statuses in its `### Visual proof` section:

- `PROVIDED` — the PR is visually inspectable, the current head has a conforming
  `provided` comment, and the attached evidence is sufficient and scope-faithful
  for the issue claim.
- `N/A` — the work is genuinely non-visual or cannot reasonably be rendered at
  this implementation stage without out-of-scope integration. A producer
  `n/a` is advisory evidence, not authority.
- `MISSING` — visually inspectable work could reasonably have been demonstrated,
  but current-head proof is absent, stale, materially insufficient, overclaims
  scope, or the producer's `n/a` is unjustified.

A clearly non-visual backend/CLI/internal PR can be `N/A` even without a producer
comment; `review-gate` owns the classification. Conversely, a renderable UI
component does not become `N/A` merely because the producer said so.

## Verdict integration

Visual proof does not add a new review-gate verdict state, workflow state, label,
or `blocking-set` field.

- `MISSING` by itself prevents `merge-candidate` and yields `blocked`, because it
  is an evidence gap rather than a repo-relative code finding.
- If independent `fix-now` findings already require `needs-fix`, keep that
  verdict and list only their repo-relative files in `blocking-set`; record the
  visual-proof gap as an additional merge precondition.
- `PROVIDED` and `N/A` do not override code/spec findings or check-run readiness.

Visual proof is part of the current-head evidence bundle and may be re-evaluated
on every review round. This does not authorize round `N > 0` to discover new code
findings outside the existing prior-blocking-set/diff rules.

## Scenario contract

These scenarios are load-bearing:

- **current proof:** current-head `provided` + sufficient + scope-faithful ->
  `PROVIDED`;
- **stale proof:** only older-head proof for otherwise renderable visual work ->
  `MISSING`;
- **justified N/A:** no reasonable render path without out-of-scope integration
  -> `N/A`;
- **unjustified N/A:** renderable visual work + producer `n/a` -> `MISSING`;
- **missing proof:** renderable visual work + no current proof -> `MISSING`;
- **non-visual work:** backend/CLI/internal-only change -> `N/A`;
- **scope overclaim:** current `provided` evidence that claims integration beyond
  what it demonstrates -> `MISSING`.
