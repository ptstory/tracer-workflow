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
without this exact prefix is not a verdict and is ignored. A verdict is valid only
when its GitHub comment author is in the configured `TRACER_REVIEWER_LOGINS`
comma-separated reviewer allowlist. Readers fail closed if it is unset and report
header-matching comments from other authors as ignored.

Required fields immediately below the marker:

- `head-sha:` — full 40-character commit SHA
- `review-round:` — integer, 0-based
- `reviewed-files:` — integer
- `blocking-set:` — comma-separated targets for every `fix-now` finding; use
  repo-relative file paths for code/document findings and the literal `PR body`
  for PR-body contract violations, which are fixed in PR metadata rather than a
  repository file. Required for `blocked` and `needs-fix` when such findings
  exist, and empty only when there are no `fix-now` findings.
- `next-action:` — one concrete copy-pasteable command or invocation for the
  verdict state; never empty on newly emitted verdicts. Historical verdicts
  emitted before this field was required remain valid without it for round
  history and circuit-breaker derivation. Readers that do not yet parse this
  field remain compatible until the follow-up enforcement change lands.

Conditional marker immediately below the required fields:

- `rebaseline:` — literal `yes` only on the fresh round-0 verdict after a
  late-created or materially amended binding issue; omitted otherwise

A newly emitted comment missing any required field is not a verdict and readers
ignore it. Historical comments are judged by the schema in effect when they
were emitted; the new writer requirement does not invalidate prior verdicts.

## Comment-only, no ref mutation

The reviewer posts comments. It never pushes, merges, edits refs, or changes
labels. GitHub blocks a formal REQUEST_CHANGES review on a self-authored PR anyway,
so the state lives in comment text, not in `reviewDecision`. Do not read
`gh pr view --json reviewDecision` for the verdict — read the comment body.

## Next action by verdict state

Use one state-specific `next-action:` template per verdict, with real PR
references and the reviewed SHA substituted:

- `needs-fix`: `next-action: from-pr-review <PR_URL>` in a new fixer session
  for this round, never the implementing session.
- `merge-candidate`: `next-action: gh pr merge N --squash --match-head-commit <sha>`
  for a human to run after confirming current-head checks and authority. If the PR
  is draft, `next-action: gh pr ready N` instead; changing draft status alone does
  not require another verdict at the same SHA.
- `blocked`: `next-action: gh pr checks N`
  if current-head checks are pending; otherwise use one exact command to
  inspect or resolve the named blocker.
- `needs-human`: `next-action: gh pr view N --web` so a human can make the
  named decision. Never send an automated fixer to this state.

## Verdict comments are append-only

Verdict comments are append-only. Do not edit a prior gate comment in place,
including to repair malformed fields or missing lines. If a verdict comment is
malformed, post a new verdict comment; round derivation depends on the count and
order of conforming verdict comments.

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

If the binding issue is created or materially amended after a verdict has
already been emitted, the next review is a re-baselined round 0 against the new
spec. That review emits the complete current blocking set in one verdict
comment, carries `rebaseline: yes`, and later round numbers derive from
verdicts emitted after that rebaseline.

## Review rounds

Round 0 is the first review of a PR for the current spec baseline: full review
against the binding contract.

Round `N > 0` reviews:

- the previously reported blocking findings,
- the diff since the previously reviewed head SHA,
- regressions introduced by that diff, and
- anything in the binding contract the diff newly violates.

Derive `review-round` as follows:

- `review-round` equals the number of prior conforming verdict comments on the
  PR for the current spec baseline. Count trusted historical comments emitted
  before `next-action:` became required when they carry the marker and the
  previously required `head-sha:`, `review-round:`, `reviewed-files:`, and
  `blocking-set:` fields, even if `next-action:` is absent. Count later comments
  only when all five fields are present. Preserve these earlier rounds when
  applying the stale-finding rule and counting corrective rounds for the
  circuit breaker; the schema change alone is not a rebaseline.
- The first review of a PR therefore emits `review-round: 0`.
- Comments missing the marker or a field required at the time of emission are
  not verdicts and do not increment the round.
- Review responses, disposition comments, and any other PR comment do not
  increment the round.
- A rebaseline caused by a late-created or materially amended binding issue
  resets the round counter; the next conforming verdict emits `review-round: 0`
  and `rebaseline: yes`.
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

Acceptance-criteria rule: an unmet acceptance criterion of the binding issue is
`fix-now` at any round while the PR still closes that issue, unless the agent
cannot carry out its remediation in this repository with its available tools and
capabilities. In that agent-unremediable case, the finding is `needs-human`, not
`fix-now`, even when it is an unmet acceptance criterion. Examples include
required evidence that cannot be attached through the available GitHub interface,
physical-device or manual interactive verification, and a check for which the
repository has no capable CI. Do not use this exception for work that is merely
difficult or has not yet been attempted.

Every agent-unremediable finding must include a manual-verification checklist
that states what to check, where to check it (for example, the PR's deploy preview
URL), and the expected result. If the location or environment is unavailable,
state who must provide it and what must be checked once available. This explicit
`needs-human` disposition takes precedence over the acceptance-criterion
`fix-now` rule. For other unmet acceptance criteria, `follow-up-issue` is
available only if the closing linkage changes in the same pass so the PR no
longer closes the issue. This carve-out resolves a round-1 / round-2 conflict
observed in an earlier private-repository review.

Rationale: a gate that can raise pre-existing conditions at any round has no
termination condition.

## Circuit breaker

The breaker counts corrective rounds, not total conforming verdicts.

A corrective round is a post-baseline review whose diff since the previously
reviewed SHA touches at least one file named in the prior blocking set. A rerun
on an unchanged head does not increment the breaker. A merge or rebase whose
diff touches none of those files is not corrective and does not increment the
breaker.

After two corrective rounds, any later corrective review yields `needs-human`.

In that same verdict the reviewer records a disposition for every surviving
finding:

- regressions stay `fix-now` and are named as human blocking concerns; the
  `blocking-set` remains empty for `needs-human`;
- everything else becomes `follow-up-issue` with a one-line summary suitable
  for filing.

The breaker never silently waives a finding and never auto-files an issue
itself.

## Readiness and evidence continuity

`merge-candidate` is determined by the target branch's required status-check
configuration.

- Configured path: all applicable required checks are green at the current head,
  and at least one applicable required check exercises the changed paths.
- No-required-check path: at least one green CI/check run on the current head
  exercises the changed paths.
- A no-capable-check escalation is allowed only when repository CI/check
  configuration is known, every configured required check has a successful
  result at the current head, and none can exercise the changed paths. If any
  required check is failing, pending, or missing from current-head check evidence,
  emit `blocked` regardless of whether it can exercise the changed paths. When
  all required checks are green but none can exercise the changed paths, an
  otherwise-clean review emits a `needs-human` finding, not `blocked`. Include
  the manual-verification checklist required above; identify the behavior to
  verify, where to verify it (for example, the PR's deploy preview URL), and the
  expected result. This applies to both readiness paths when no capable check
  exists.
- If readiness configuration or current-head evidence cannot be established,
  emit `blocked` rather than assuming no capable check exists. Older-head results
  do not satisfy readiness.
- Draft status is informational and does not change readiness or review
  requirements. A clean draft that satisfies readiness is `merge-candidate`;
  use `gh pr ready N` as its next action. Changing draft status alone does not
  require another verdict at the same SHA.
- Older-head results never count.
- Branch protection is not required. `getBranch protected: false` is sufficient evidence that no classic required checks exist; `/protection` is not required, and its 403 is not a readiness blocker when `protected: false`. Record the readiness evidence path in the Review Record as `available`, `plan-unavailable`, or `indeterminate`. Try `rules/branches/{branch}` first; when the calling surface rejects it before reaching GitHub (including HTTP 400/unsupported endpoint), fall through to `rulesets`. HTTP 403 with the exact body message `Upgrade to GitHub Pro or make this repository public to enable this feature.` from either endpoint, with no classic required checks, uses the no-required-check path and records `plan-unavailable`; name the successful evidence call next to the path. Captured bodies: 2026-10-08 rules-for-branch, HTTP 403, `{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.","documentation_url":"https://docs.github.com/rest/repos/rules#get-rules-for-a-branch","status":"403"}`; 2026-10-10 get-all-repository-rulesets on a private repo under GitHub Free, HTTP 403, `{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.","documentation_url":"https://docs.github.com/rest/repos/rules#get-all-repository-rulesets","status":"403"}`. Any other status or message, including HTTP 400 except the described pre-GitHub endpoint rejection, or both rules calls unreachable, is `rules-unverifiable`: record `indeterminate`, name each call and status, and preserve every fix-now file in `blocking-set`. Record `available` when usable configuration is obtained.
- Merge remains HITL.

On round `N > 0`, compare the current evidence bundle with the prior round's bundle. For any claim of added or changed coverage, require new or modified test node IDs in the diff since the previously reviewed SHA, and verify those exact IDs are present in runner-generated output showing they passed at the current head. A changed test ID with a green current-head result is consistent even when the aggregate test count is unchanged; this includes replacing an invalid test with a valid one. A claim that lacks matching changed test IDs or current-head green runner output is an evidence inconsistency: report it as a `fix-now` finding under `needs-fix`, not `blocked`. Reserve `blocked` for missing or incomplete current-head CI/readiness evidence needed to determine the check-run gate.

## Verdict precedence

Apply the first matching rule, in this order:

1. If a credible review cannot be completed, emit `blocked`.
2. If any finding has disposition `needs-human`, or the circuit breaker is
   triggered, emit `needs-human`.
3. If any `fix-now` findings remain, emit `needs-fix`, regardless of draft status
   or one-way-door designation.
4. If the review is otherwise clean and `Door: one-way`, emit `needs-human`.
5. If the review is clean and readiness is satisfied, emit `merge-candidate`.
6. Otherwise emit `blocked`.

For one-way-door PRs, the designation alone does not prevent fixing ordinary
findings. Escalate to a human after those findings are cleared. Explicit
`needs-human` findings and the circuit breaker always take precedence over
`fix-now`. Agent-unremediable acceptance-criterion findings are explicitly
`needs-human`; a no-capable-check readiness gap becomes a `needs-human` finding
only when the review is otherwise clean. Thus these cases use the existing
precedence order and still yield exactly one verdict state; other `fix-now`
findings remain `needs-fix` when no higher-priority rule matches.

## What the reader does per state

- `merge-candidate` + SHA current + non-draft PR → eligible to merge; human
  still owns the button for HITL.
- `needs-fix` + SHA current → run the fix pass on `fix-now` findings via
  `skills/from-pr-review/references/disposition-rules.md`; any push invalidates this verdict and requires a
  fresh review.
- `needs-human` → stop. No automatic fix pass may be launched, at any SHA.
- `blocked` → stop, surface the blocker (for example parse failure or
  required-check coverage gap). Evidence inconsistencies are `fix-now` findings
  under `needs-fix`, not `blocked`.
- SHA stale (any state) → do nothing; wait for a verdict on current head.

`needs-human` is a hard stop for automated actors.

A reader that cannot parse `review-round:` must treat the verdict as unparseable
and stop rather than defaulting to round 0.

## Consumers

The following consumers must change to conform to this contract:

- `skills/review-gate/PROMPT.md` — emit `review-round:` and apply the round,
  stale-finding, and circuit-breaker rules.
- `skills/from-pr-review/SKILL.md` — require per-item disposition via
  `skills/from-pr-review/references/disposition-rules.md` before any fixer batch, and align its disposition
  vocabulary.
- `tooling/review-gate-poller/` — parse `review-round:` and refuse to act on
  `needs-human`.
- `prompts/agent-brief.md` — mark requirements as derived from the issue body vs
  newly discovered.

Do not treat those consumers as conforming until their follow-up PRs land.
