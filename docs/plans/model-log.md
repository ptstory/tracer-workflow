# Model log

One line per finished issue. See `2026-09-29-stack-and-model-plan.md` section 4b.
Add a dated line to STACK.md whenever the stack changes.

| Date | Repo#issue | Model (from session header) | Needs-fix rounds | Accepted | Human repair | Escalated |
|---|---|---|---|---|---|---|

## Spot check (#182): setup

Recorded before the first decision run. Nothing in Crush changes until the last run is graded.

| Item | Value |
|---|---|
| Crush config | `ptstory/crush-config` @ `e32a32c4b5bd060733a3b12558abce8bf89cb03a` (branch `chore/skill-symlinks-20261001`, clean tree, pushed) |
| Skills content | `~/.agents/skills`: 16 files, manifest SHA-256 `36826df4d97ccb4beec713162ffa6ba16a1c09633d47810b040bced6b809fbde` (`~/crush-skills-manifest-20261001.txt`); frozen 2026-10-01 before pilots; re-check before `report` |
| Harness | `ptstory/tracer-workflow` @ `35b6a71`, run from worktree `~/Code/tracer-workflow-spot-check` |
| Crush | v0.97.1 |
| Price override | Skipped (`crush-prices.json` not merged); quota measured from the authenticated Codex account rate-limit snapshot |
| Seed | `20260930` (chosen 2026-09-30, before any run) |
| Run order | Below; output of `order --seed 20260930`, identical on the Mac and in the cloud container |

```
 1  worklog-3  arm B  trial 1
 2  worklog-3  arm A  trial 1
 3  vibecoding-status-web-12  arm A  trial 1
 4  vibecoding-status-web-12  arm B  trial 1
 5  doordash-delivered-5  arm B  trial 2
 6  doordash-delivered-5  arm A  trial 2
 7  thread-atlas-155  arm B  trial 1
 8  thread-atlas-155  arm A  trial 1
 9  doordash-delivered-4  arm A  trial 1
10  doordash-delivered-4  arm B  trial 1
11  thread-atlas-64  arm A  trial 1
12  thread-atlas-64  arm B  trial 1
13  thread-atlas-149  arm A  trial 2
14  thread-atlas-149  arm B  trial 2
15  doordash-delivered-5  arm A  trial 1
16  doordash-delivered-5  arm B  trial 1
17  thread-atlas-155  arm A  trial 2
18  thread-atlas-155  arm B  trial 2
19  vibecoding-status-web-12  arm A  trial 2
20  vibecoding-status-web-12  arm B  trial 2
21  thread-atlas-149  arm A  trial 1
22  thread-atlas-149  arm B  trial 1
23  whatimeant-20  arm A  trial 1
24  whatimeant-20  arm B  trial 1
```

## Spot check (#182): Pilot A and runner amendment — 2026-10-01

Pilot A is complete and will not be rerun.

```yaml
task: tracer-workflow-71
arm: A
model: gpt-6-luna
reasoning: max
run dir: /Users/perrystory/spot-runs/tracer-workflow-71-A-t1-2026-10-01T08-31-44-274Z
session: 62a8199479572d91
worker commit: 4114931
passed: true
invalid: false
modelMatches: true
assistantMessages: 49
toolCalls: 55
subagentCalls: 1
wallSeconds: 311
cost: 0.178112
usage before: 5-hour 100% left; weekly 54% left
usage after: 5-hour 99% left; weekly 54% left
```

Pilot A exposed excessive manual ceremony, so the harness is being amended **after Pilot A and before any decision run**. The seed (`20260930`), task manifest, hidden tests, arm definitions, grading rules, and preregistered 24-run order are unchanged.

Runner amendment:
- `prepare` generates a project-local `.crushrc` that pins both large and small slots to the arm model/reasoning effort and disables provider auto-update.
- New `run` command captures the before/after Codex quota automatically from `codex app-server`, launches headless Crush, discovers exactly one new top-level session, and invokes the existing `grade` path automatically.
- Headless launch passes the arm model explicitly for both `--model` and `--small-model`.
- Crush v0.97.1 has a headless `--reasoning-effort` flag, so the runner passes the arm effort explicitly as well. The older Crush issue #3540 predates this release; the run-local `.crushrc` remains the project-scoped source of the same settings.
- `CRUSH_DISABLE_PROVIDER_AUTO_UPDATE=1` is set for headless execution and session discovery.

Pilot B remains `worklog-2`, Arm B, and is discarded. It is the acceptance test for this amended execution path. No decision run starts unless Pilot B has `modelMatches: true`, `invalid: false`, populated session/tool metrics, and a real hidden-test grade.

Local cleanup before Pilot B: restore the manually edited global `~/.config/crush/crushrc` to the recorded `ptstory/crush-config@e32a32c4b5bd060733a3b12558abce8bf89cb03a` baseline and verify the config repo is clean. Arm-specific changes now belong only in each generated run directory.

Runner implementation provenance: branch `chore/model-spot-check-runner-automation` was created directly from `63472bffb5d881c5d2e603146c04a3ac0d42ccaf`. The amendment changes only harness code, harness tests, runbook, and experiment log; `tooling/model-spot-check/tasks.json` is unchanged from `63472bf`.

Automated quota capture validation — 2026-10-01:
- A direct `codex app-server` probe confirmed the currently authenticated Codex CLI account is the intended GivenPrompt ChatGPT Plus account.
- `account/rateLimits/read` returned the `codex` bucket with a 300-minute primary window at 1% used and a 10,080-minute secondary window at 46% used.
- That normalizes to `5-hour 99% left; weekly 54% left`, exactly matching Pilot A's previously recorded post-run Usage-page reading.
- The runner now stores normalized `usage-before.json` / `usage-after.json` snapshots automatically and pins only a SHA-256 account fingerprint under `~/spot-runs/codex-account.sha256`; it aborts if the Codex login changes.
- This is an execution/measurement automation amendment made before any decision run. The decision rule, arms, tasks, hidden tests, seed, and run order remain unchanged.


## Spot check (#182): Pilot B — 2026-10-01

Pilot B validated the amended automated execution path and is discarded from the decision result.

```yaml
task: worklog-2
arm: B
model: gpt-6.1-sol
reasoning: high
run dir: /Users/perrystory/spot-runs/worklog-2-B-t1-2026-10-01T09-15-59-840Z
session: 32ba6ebe7432fb0d
passed: true
invalid: false
modelMatches: true
assistantMessages: 23
toolCalls: 32
subagentCalls: 0
wallSeconds: 323
cost: 0.6336647999999999
usage before: 5-hour 99% left; weekly 54% left
usage after: 5-hour 92% left; weekly 53% left
skills:
  - from-issue
findings:
  - note: outside-path /Users/perrystory/.local/share/mise/installs/bun/1.3.14/bin/bun
  - note: outside-path /Users/perrystory/.local/share/mise/installs/node/26.8.2/bin/tsc
```

Acceptance:
- Headless Crush selected only `gpt-6.1-sol`.
- Hidden grading ran and passed.
- Leakage/model validity checks passed; the two outside-path findings are executable-location notes, not violations.
- Automatic top-level session discovery worked.
- Automatic Codex quota capture worked before and after with no human quota prompts.
- The verified account fingerprint remained pinned.

The automated runner is accepted for the 24 preregistered decision runs. Decision run #1 remains `worklog-3`, Arm B, trial 1.
