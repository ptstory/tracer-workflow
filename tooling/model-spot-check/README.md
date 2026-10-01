# Model spot check

This runs the same eight past tasks on two Crush model arms, starting each run from the task's original base commit, and grades every run with the merged PR's own tests. It answers one question: should Crush's large model default to `gpt-6-luna` (Max) or `gpt-6.1-sol` (high)?

The decision rule and its rationale are in `docs/plans/2026-09-29-stack-and-model-plan.md`, section 4a. The rule was fixed before any run.

## What is in this directory

| File | Purpose |
|---|---|
| `tasks.json` | For each task: repo, issue, PR, base SHA, setup commands, graded tests, excluded tests and why. Each graded command was checked on 2026-09-30 to pass on the PR head and fail on base plus hidden tests. |
| `interfaces/<task>.md` | Interface requirements appended to the task's `ISSUE.md`, identical for both arms. Several merged test suites assert module paths, function names or JSON keys that the issue never specified. Without these notes, a correct solution with different names would fail. The notes give names and shapes only, never expected results. |
| `spot-check.ts` | Commands: `order`, `prepare`, `run`, `grade`, `report`. `run` is the normal execution path; `prepare` + interactive Crush remains the fallback. |
| `lib.ts`, `spot-check.test.ts` | Pure logic, and tests for it: run order, session parsing, leakage scan, decision rule. |
| `crush-prices.json` | Optional price overrides so Crush's `cost` tracks quota. See "Measuring quota" below. |

## One-time setup (on your Mac)

1. Install `git`, `gh`, `bun`, `python3`, Node 20 or newer (the graders use `node --test --test-name-pattern`), and `crush`.
2. Run `gh auth status` and `gh auth setup-git`. Grading fetches hidden tests from private repos over HTTPS.
3. Record the frozen `~/.config/crush` commit in the model log. Before Pilot B, restore the global config to that recorded baseline and leave it unchanged through the experiment; arm-specific model settings now live only in each generated run directory.

## Procedure

Every command below is run from the tracer-workflow checkout.

**1. Fix the order.** Choose a seed, write it in the model log, then:

```sh
bun tooling/model-spot-check/spot-check.ts order --seed <n>
```

Easy tasks get 2 trials per arm and hard tasks 1, so 24 runs. Run them in the printed order.

**2. Pilots (results discarded).**

Pilot A was run manually before the automated path existed. Do not rerun it.

Pilot B validates the automated path end to end:

```sh
bun tooling/model-spot-check/spot-check.ts run worklog-2 --arm B
```

`run` performs `prepare`, writes a project-local `.crushrc`, captures the current Codex quota from `codex app-server` (`account/read` + `account/rateLimits/read`), snapshots the current top-level Crush session IDs, launches headless Crush, captures quota again, requires exactly one new top-level session, and feeds that session directly to `grade`.

For each arm the generated `.crushrc` pins both large and small model slots to the arm model and reasoning effort and disables provider auto-update. On Crush v0.97.1 the runner also passes `--model`, `--small-model`, and `--reasoning-effort` explicitly. The explicit model flags defend against historical headless model-selection bugs; the local config remains the project-scoped source of the arm settings.

Pilot B is acceptable only if:
- `modelMatches: true`
- `invalid: false`
- the hidden graded command actually runs
- session/tool metrics are populated and plausible

If that fails because headless Crush is unreliable, use `prepare` and launch interactive `crush` from the generated work directory. The local `.crushrc` means no model-picker changes are needed; only the prompt paste and session identification remain manual.

**3. Decision runs.** For each slot in the preregistered order:

```sh
bun tooling/model-spot-check/spot-check.ts run <task> --arm <A|B> --trial <n>
```

There are no normal human inputs during a run. The harness stores normalized `usage-before.json` and `usage-after.json` beside the other run artifacts and writes the familiar `5-hour …% left; weekly …% left` strings into `result.json`.

The first automated capture pins a SHA-256 fingerprint of the verified Codex account under `~/spot-runs/codex-account.sha256`; later captures abort if the Codex login changes. No email or account ID is stored in that pin file.

Do not run other work on the GivenPrompt OpenAI/Codex account while a benchmark run is active. If the 5-hour limit hits mid-run, abandon that run and prepare it again in the next window. Never switch models mid-run.

**4. Interactive fallback.** `prepare` still creates the isolated worktree and run-local `.crushrc` without launching Crush:

```sh
bun tooling/model-spot-check/spot-check.ts prepare <task> --arm <A|B> --trial <n>
```

Then run `CRUSH_DISABLE_PROVIDER_AUTO_UPDATE=1 crush` from the printed work directory, paste the printed worker prompt, identify the one new top-level session with `crush session list --json`, and invoke `grade` manually. The manual fallback may still accept explicit `--usage-before` / `--usage-after` strings if needed.

**5. Adjudicate failures.** For each FAIL, read `graded.tail` in the run's `result.json`. If the failure is an interface mismatch rather than wrong behavior, note it in the model log with the reason. Decide the classification before you look at which arm produced it; the arm is in the run directory name, so cover it.

**6. Report / telemetry backfill.**

```sh
bun tooling/model-spot-check/spot-check.ts report
```

`report` first refreshes every existing result from its saved `session.json`; it does not launch a model or rerun hidden tests. This backfills native session token telemetry for older runs, then prints correctness plus per-run and aggregate prompt/completion/total tokens, wall time, and recorded cost.

The historical replay was stopped pragmatically after four complete pairs / eight decision runs on 2026-10-01. The original 24-run preregistration is retained for provenance; the closeout report describes only the completed sample. Ongoing routing evidence comes from the production log in section 4b.

## What makes a run invalid

`grade` marks a run INVALID, and it is redone, when any of these happen:
- The session used a model other than the arm's model.
- The generated run-local `.crushrc` was changed or removed during the run.
- A tool call used `fetch`, `agentic_fetch`, `download`, `sourcegraph` or a web tool.
- A shell command used `gh`, `curl`, `wget`, or a networked git command.
- A tool call touched a path under `~/Code`, where the original checkouts and their `.worktrees/issue-*` directories hold the historical answers.

Reads under `~/.config/crush`, `~/.agents/skills` and `~/.claude/skills` are allowed. Any other path outside the work directory is listed as a note.

Two limits:
- Crush hooks and session records don't cover subagent sessions; `grade` counts `agent` calls so you can see when this applied. `crush session list --json` itself lists only top-level sessions, so subagent sessions do not break automatic session discovery.
- Dependency installs happen in `prepare`, before the agent starts. DuckDB's `sqlite_scanner` extension is pre-installed for thread-atlas tasks for the same reason.

## Measuring efficiency and quota

For per-run model efficiency, use Crush session `prompt_tokens`, `completion_tokens`, native `total_tokens`, wall time, and recorded session cost. Token counts are the primary consumption telemetry for comparing runs; the account quota meter is operational pressure telemetry, not a precise per-run efficiency measure.

The structured Codex account rate-limit snapshot returned by the local `codex app-server` RPC `account/rateLimits/read`, using the same authenticated Codex account as the CLI.

The harness reads the `codex` bucket and records:
- the 300-minute window as the 5-hour limit;
- the 10,080-minute window as the weekly limit;
- `remainingPercent = 100 - usedPercent`;
- each reset timestamp.

This source was validated on 2026-10-01 against the previously recorded Pilot A Usage-page reading: the automated snapshot reported 1% used / 46% used, which renders as `5-hour 99% left; weekly 54% left`, exactly matching Pilot A's recorded post-run UI values.

Quota snapshots remain useful for knowing whether the account is near a limit or crossed a reset. A reset does not invalidate correctness or token telemetry. Session cost is supplementary to token counts and may reflect model-specific pricing.
