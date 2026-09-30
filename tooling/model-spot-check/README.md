# Model spot check

This runs the same eight past tasks on two Crush model arms, starting each run from the task's original base commit, and grades every run with the merged PR's own tests. It answers one question: should Crush's large model default to `gpt-6-luna` (Max) or `gpt-6.1-sol` (high)?

The decision rule and its rationale are in `docs/plans/2026-09-29-stack-and-model-plan.md`, section 4a. The rule was fixed before any run.

## What is in this directory

| File | Purpose |
|---|---|
| `tasks.json` | For each task: repo, issue, PR, base SHA, setup commands, graded tests, excluded tests and why. Each graded command was checked on 2026-09-30 to pass on the PR head and fail on base plus hidden tests. |
| `interfaces/<task>.md` | Interface requirements appended to the task's `ISSUE.md`, identical for both arms. Several merged test suites assert module paths, function names or JSON keys that the issue never specified. Without these notes, a correct solution with different names would fail. The notes give names and shapes only, never expected results. |
| `spot-check.ts` | Commands: `order`, `prepare`, `grade`, `report`. |
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

**2. Pilot (results discarded).**

```sh
bun tooling/model-spot-check/spot-check.ts prepare tracer-workflow-71 --arm A
bun tooling/model-spot-check/spot-check.ts prepare worklog-2 --arm B
```

`prepare` prints the exact steps: which model to set in the picker, the prompt to paste, and the `grade` command to run afterwards. The pilot should confirm four things:
- `grade` reports the session's model, and the model matches the arm.
- Tool calls are counted.
- The leakage scan reports nothing unexpected.
- The hidden tests run.

**3. Decision runs.** For each slot in the order:
1. `prepare <task> --arm <A|B> --trial <n>`
2. Set the model in the picker and note the Codex usage readout.
3. Start `crush` in the printed work directory and paste the prompt.
4. When the agent stops, note the readout again.
5. Run `grade <runDir> --session <id> --usage-before … --usage-after …`.

If the 5-hour limit hits mid-run, abandon that run and prepare it again in the next window. Never switch models mid-run.

**4. Adjudicate failures.** For each FAIL, read `graded.tail` in the run's `result.json`. If the failure is an interface mismatch rather than wrong behavior, note it in the model log with the reason. Decide the classification before you look at which arm produced it; the arm is in the run directory name, so cover it.

**5. Report.**

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
- Crush hooks and session records don't cover subagent sessions; `grade` counts `agent` calls so you can see when this applied.
- Dependency installs happen in `prepare`, before the agent starts. DuckDB's `sqlite_scanner` extension is pre-installed for thread-atlas tasks for the same reason.

## Measuring quota

The primary measure is the Codex usage readout before and after each run, with nothing else using the account in between.

Crush's session `cost` is cumulative and includes subagents. But it is priced from the provider catalog, which currently lists $0 for every OpenAI model. To make `cost` meaningful, merge `crush-prices.json` into your Crush config's OpenAI provider, then check that a short session shows a non-zero cost. Crush issue #2649 reports custom model entries being overridden by the embedded catalog. Listing models explicitly may also stop Crush auto-discovering the others, so afterwards check that the picker still shows every model you use. Note: `cost_per_1m_in_cached` prices cache writes, and `cost_per_1m_out_cached` prices cache reads. If `cost` and the readout disagree, trust the readout.
