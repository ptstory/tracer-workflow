# Production model telemetry

Passive, local telemetry for the real Luna → Review Gate → repair/escalation workflow.

This is **not** the historical model spot check. It records work that was going to happen anyway and lets the routing policy accumulate evidence over time.

## What it records

For each observed Crush session:

- session ID
- repository, branch, and HEAD at first observation
- PR and closing issue linkage when available
- model(s) and reasoning effort when Crush exposes it
- end-of-session context token snapshot (`prompt_tokens` / `total_tokens`) and last-step output tokens
- cumulative recorded model cost
- session wall time
- assistant/tool/subagent counts
- skills used

For each trusted Review Gate comment:

- verdict
- review round
- reviewed-file count
- blocking set
- fix-now count
- reviewed head SHA and timestamp

It does **not** copy prompts, assistant messages, tool payloads, code, diffs, or review prose into the production ledger.

## Storage

Default state root:

```text
~/.local/state/tracer/model-telemetry/
  sessions/<session-id>.json   # write-once raw observation marker
  attempts.jsonl               # refreshable derived session metrics
  reviews.jsonl                # refreshable trusted Review Gate events
```

Override with `TRACER_MODEL_TELEMETRY_ROOT`.

The raw marker exists so a later sync can resolve the session after it has finished. Derived JSONL files are regenerated from the markers plus current Crush/GitHub state, so rerunning sync is idempotent.

## Passive capture

Crush currently supports `PreToolUse` hooks but not a session-end hook. The global Crush config should mark a session on its first tool call:

```sh
hook add PreToolUse \
  --command "bun /Users/perrystory/Code/tracer-workflow/tooling/model-telemetry/model-telemetry.ts mark" \
  --name model-telemetry \
  --timeout 2
```

`mark` is cheap and idempotent: after `sessions/<id>.json` exists, later tool calls are a filesystem existence check and return.

A coding session that never invokes a tool is not captured. That is intentional; such sessions do not materially implement repository work.

## Sync

```sh
bun tooling/model-telemetry/model-telemetry.ts sync
# or
bun run model:sync
```

Sync:

1. reads every session marker;
2. asks Crush for the final saved session metadata using `crush session show <id> --json`;
3. resolves the branch to its GitHub PR with `gh pr list --state all --head <branch>`;
4. records closing issue references;
5. parses allowlisted Review Gate comments;
6. rewrites `attempts.jsonl` and `reviews.jsonl`.

Set `TRACER_REVIEWER_LOGINS` to the same comma-separated reviewer allowlist used by the Review Gate readers. If it is absent, attempt metrics still sync and existing review telemetry is preserved, but new review comments are not trusted/imported.

No model is called during sync.

## Report

```sh
bun tooling/model-telemetry/model-telemetry.ts report
# or
bun run model:report
```

Report syncs first by default. Use `--no-sync` for a local-only read or `--json` for lifecycle JSON.

The lifecycle join is chronological. For one PR it classifies:

- first observed attempt → `initial`
- later Luna attempt → `repair`
- Sol attempt after Luna plus a prior `needs-fix` → `escalation`

An attempt is associated with the first trusted Review Gate verdict after that session ends and before the next observed attempt begins.

The summary is designed to answer:

- Luna first-pass acceptance rate
- Luna repair success rate
- Sol escalation rate
- Sol escalation success rate
- final context footprint / wall time / cumulative recorded model cost per accepted PR
- review rounds
- recurring blocking paths

## Routing policy being measured

The production policy after the 2026-10-01 spot check is:

1. Luna is the normal first executor.
2. Run Review Gate.
3. If the finding is ordinary/local and repairable, give Luna one repair pass.
4. If a substantive correctness/integration problem persists, escalate to Sol.
5. A deep semantic/identity/cross-system contract miss may escalate directly after the first review rather than spending the Luna repair pass.

The telemetry measures the policy; it does not autonomously choose or launch Sol.

## Limitations

- The hook records git context at the first tool call. Session-to-review matching therefore uses PR identity and timestamps, not an assumption that the first observed HEAD is the final commit.
- PR discovery requires the session's branch to correspond to a GitHub PR. Sessions before a PR exists remain in `attempts.jsonl` with `prNumber: null`; rerunning sync can attach them later after the PR is opened.
- Review Gate comments must be authored by `TRACER_REVIEWER_LOGINS`.
- Reasoning effort is recorded only when the Crush session JSON exposes it.
- Crush's saved `prompt_tokens` / `completion_tokens` are the latest step's context/output counters, not cumulative session token spend. `session.cost` is cumulative. The report therefore labels tokens as a final context snapshot and does not sum them across attempts. If Crush later persists per-step usage, this collector can add true cumulative token volume without changing the lifecycle model.
- Recorded cost can differ materially between model families even when final context size is similar.
