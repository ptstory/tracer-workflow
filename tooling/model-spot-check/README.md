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
3. Commit everything in `~/.config/crush` and record the commit SHA in the model log. Change nothing in Crush until the last run is graded.

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

`run` performs `prepare`, writes a project-local `.crushrc`, asks for the Codex usage readout, snapshots the current top-level Crush session IDs, launches headless Crush, asks for the usage readout again, requires exactly one new top-level session, and feeds that session directly to `grade`.

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

The only normal human inputs are the two Codex usage readings:

```text
usage before >
...
usage after >
```

Do not run other work on the GivenPrompt OpenAI/Codex account between those readings. If the 5-hour limit hits mid-run, abandon that run and prepare it again in the next window. Never switch models mid-run.

**4. Interactive fallback.** `prepare` still creates the isolated worktree and run-local `.crushrc` without launching Crush:

```sh
bun tooling/model-spot-check/spot-check.ts prepare <task> --arm <A|B> --trial <n>
```

Then run `CRUSH_DISABLE_PROVIDER_AUTO_UPDATE=1 crush` from the printed work directory, paste the printed worker prompt, identify the one new top-level session with `crush session list --json`, and invoke `grade` manually with the two usage readings.

**5. Adjudicate failures.** For each FAIL, read `graded.tail` in the run's `result.json`. If the failure is an interface mismatch rather than wrong behavior, note it in the model log with the reason. Decide the classification before you look at which arm produced it; the arm is in the run directory name, so cover it.

**6. Report.**

```sh
bun tooling/model-spot-check/spot-check.ts report
```

This applies the easy-tier rule.
- The hard tier does not decide the default. Where Luna fails a hard task, that failure defines the escalation trigger.
- `reviewDerived` results (doordash #4's map geometry) are reported separately.

## What makes a run invalid

`grade` marks a run INVALID, and it is redone, when any of these happen:
- The session used a model other than the arm's model.
- A tool call used `fetch`, `agentic_fetch`, `download`, `sourcegraph` or a web tool.
- A shell command used `gh`, `curl`, `wget`, or a networked git command.
- A tool call touched a path under `~/Code`, where the original checkouts and their `.worktrees/issue-*` directories hold the historical answers.

Reads under `~/.config/crush`, `~/.agents/skills` and `~/.claude/skills` are allowed. Any other path outside the work directory is listed as a note.

Two limits:
- Crush hooks and session records don't cover subagent sessions; `grade` counts `agent` calls so you can see when this applied. `crush session list --json` itself lists only top-level sessions, so subagent sessions do not break automatic session discovery.
- Dependency installs happen in `prepare`, before the agent starts. DuckDB's `sqlite_scanner` extension is pre-installed for thread-atlas tasks for the same reason.

## Measuring quota

The primary measure is the Codex usage readout before and after each run, with nothing else using the account in between.

Crush's session `cost` is cumulative and includes subagents. But it is priced from the provider catalog, which currently lists $0 for every OpenAI model. To make `cost` meaningful, merge `crush-prices.json` into your Crush config's OpenAI provider, then check that a short session shows a non-zero cost. Crush issue #2649 reports custom model entries being overridden by the embedded catalog. Listing models explicitly may also stop Crush auto-discovering the others, so afterwards check that the picker still shows every model you use. Note: `cost_per_1m_in_cached` prices cache writes, and `cost_per_1m_out_cached` prices cache reads. If `cost` and the readout disagree, trust the readout.
