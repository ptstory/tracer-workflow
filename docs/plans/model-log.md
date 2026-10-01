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


### Scanner correction after decision run #1 — 2026-10-01

Decision run #1 (`worklog-3`, Arm B, trial 1; session `487676c3f64978dd`) initially graded `PASS (INVALID)` solely because the leakage scanner treated any literal `github.com` string inside any tool payload as evidence of network access.

That rule was a harness implementation bug for this task: worklog issue #3 explicitly requires canonical GitHub URLs and public/private GitHub fixtures, so writing a GitHub URL into `test/ledger.test.js` is task-compliant source generation and does not establish network access.

Before accepting the run, the scanner was corrected to distinguish literals from actual network behavior:
- generated source may contain GitHub URLs and `refs/pull/...` strings;
- `gh`, `curl`, `wget`, Git network commands, forbidden network tools, and forbidden checkout paths remain violations;
- a regression test now covers GitHub URL/pull-ref literals in a `write` tool call;
- regrading replaces the prior entry for the same `runId` in `results.jsonl` rather than double-counting it.

The worker session, model, work product, hidden tests, task definition, arm definitions, seed, and run order were not changed. The existing run is regraded; it is not rerun, avoiding additional model/quota consumption.


### Decision run #1 — worklog-3 B, trial 1 — 2026-10-01

```yaml
task: worklog-3
arm: B
trial: 1
model: gpt-6.1-sol
reasoning: high
run dir: /Users/perrystory/spot-runs/worklog-3-B-t1-2026-10-01T09-24-47-156Z
session: 487676c3f64978dd
passed: false
invalid: false
modelMatches: true
assistantMessages: 23
toolCalls: 30
subagentCalls: 0
wallSeconds: 326
cost: 0.6094063999999999
usage before: 5-hour 92% left; weekly 53% left
usage after: 5-hour 85% left; weekly 52% left
findings: []
```

The initial invalidation was a scanner false positive and was corrected without rerunning the worker. Regrading the same session produced a valid hidden-grade FAIL. Hidden failure details were intentionally not inspected before the paired Luna run.


### Decision run #2 — worklog-3 A, trial 1 — 2026-10-01

```yaml
task: worklog-3
arm: A
trial: 1
model: gpt-6-luna
reasoning: max
run dir: /Users/perrystory/spot-runs/worklog-3-A-t1-2026-10-01T09-34-53-662Z
session: 467db5ea74c6cb9d
passed: false
invalid: false
modelMatches: true
assistantMessages: 23
toolCalls: 28
subagentCalls: 0
wallSeconds: 147
cost: 0.04519460000000001
usage before: 5-hour 85% left; weekly 52% left
usage after: 5-hour 85% left; weekly 52% left
findings:
  - note: outside-path /Users/perrystory/Library/Application
```

Paired hidden-grade comparison for `worklog-3`:
- Both arms are valid FAILs under the preregistered binary rule.
- Sol preserved both `pr_opened` and `pr_merged` rows for the tested interval but produced different human labels (`Opened a pull request` / `Merged a pull request`) than the hidden contract (`PR opened` / `PR merged`).
- Luna returned only `pr_opened` for the same interval, so it failed earlier on PR lifecycle/timestamp-query behavior before the hidden label assertion was reached.
- This qualitative distinction is recorded only as secondary diagnostic evidence; it does not change either arm's FAIL score.


### Decision run #3 — vibecoding-status-web-12 A, trial 1 — 2026-10-01

```yaml
task: vibecoding-status-web-12
arm: A
trial: 1
model: gpt-6-luna
reasoning: max
run dir: /Users/perrystory/spot-runs/vibecoding-status-web-12-A-t1-2026-10-01T09-40-12-087Z
session: 628ba734bfd7b1f2
passed: true
invalid: false
usage before: 5-hour 85% left; weekly 52% left
usage after: 5-hour 84% left; weekly 52% left
worker commit: 777ed89
notes:
  - worker reported npm test (123 tests) and npm run build passed
```


### Decision run #4 — vibecoding-status-web-12 B, trial 1 — 2026-10-01

```yaml
task: vibecoding-status-web-12
arm: B
trial: 1
model: gpt-6.1-sol
reasoning: high
run dir: /Users/perrystory/spot-runs/vibecoding-status-web-12-B-t1-2026-10-01T09-52-55-244Z
session: c3479b85e79d223a
passed: true
usage before: 5-hour 84% left; weekly 52% left
usage after: 5-hour 68% left; weekly 49% left
findings:
  - note: outside-path via grep: /Users/|execFile|spawn
notes:
  - worker reported all 123 tests and offline build passed
```

Paired result for `vibecoding-status-web-12`, trial 1:
- Luna: PASS
- Sol: PASS
- Under the preregistered correctness rule this pair is a tie.
- Secondary efficiency signal: Luna moved the 5-hour meter by 1 point and completed in about 2m34s end-to-end; Sol moved it by 16 points and completed in about 5m40s. The quota meter is coarse, so these are retained as operational signals rather than exact consumption measurements.


### Decision run #5 — doordash-delivered-5 B, trial 2 — 2026-10-01

```yaml
task: doordash-delivered-5
arm: B
trial: 2
model: gpt-6.1-sol
reasoning: high
run dir: /Users/perrystory/spot-runs/doordash-delivered-5-B-t2-2026-10-01T13-26-26-796Z
session: 14829fd79e7d0e54
passed: true
usage before: 5-hour 68% left; weekly 49% left
usage after: 5-hour 44% left; weekly 45% left
notes:
  - worker reported coordinated exhibit state, browser interaction verification, unit/browser regression coverage, keyboard and reduced-motion coverage
  - end-to-end runner wall time was about 9m15s
```


### Decision run #6 — doordash-delivered-5 A, trial 2 — 2026-10-01

```yaml
task: doordash-delivered-5
arm: A
trial: 2
model: gpt-6-luna
reasoning: max
run dir: /Users/perrystory/spot-runs/doordash-delivered-5-A-t2-2026-10-01T13-37-49-840Z
session: 5d4244c66c73a4a8
passed: false
usage before: 5-hour 44% left; weekly 45% left
usage after: 5-hour 100% left; weekly 45% left
notes:
  - the 5-hour quota window reset during this run; the before/after 5-hour percentage is unusable as a per-run efficiency measure
  - worker reported shared selection state and local checks passing
```

Paired result for `doordash-delivered-5`, trial 2:
- Sol: PASS
- Luna: FAIL
- This is the first correctness divergence in the three completed decision pairs.

DoorDash divergence classification:
- This is a narrow but substantive integration miss, not a hidden-test-only spelling trap.
- The frozen base already contains canonical data keys `Zaxbys`, `Jack's New Yorker Deli`, and `Five Guys Burgers & Fries`, while the rendered map uses presentation labels such as `Zaxby’s`, `Jack’s New Yorker Deli`, and `Five Guys`.
- Luna wired map IDs to the presentation labels instead of the canonical dataset identities, which would break shared-state fan-out/filter matching for those stores.
- Sol resolved the IDs to the canonical data names and passed.
- The distinction is qualitative secondary evidence; the formal score remains Sol PASS / Luna FAIL.

Telemetry amendment after run #6 (corrected after the closeout):
- The harness already received Crush session `prompt_tokens`, `completion_tokens`, and `total_tokens` in session metadata and now exposes them in `result.json`.
- Current Crush source shows these fields are replaced with each latest model step's counters; they are **not cumulative session token spend**. The harness therefore treats them as final context/output snapshots only.
- Wall time and cumulative session `cost` remain valid aggregate efficiency telemetry; quota percentages remain account-pressure telemetry only.
- Existing session artifacts can be regraded to refresh these context snapshots without rerunning model work.


### Decision run #7 — thread-atlas-155 B, trial 1 — 2026-10-01

```yaml
task: thread-atlas-155
arm: B
trial: 1
model: gpt-6.1-sol
reasoning: high
run dir: /Users/perrystory/spot-runs/thread-atlas-155-B-t1-2026-10-01T13-42-49-871Z
session: 37dabe0635acf36d
passed: true
usage before: 5-hour 100% left; weekly 45% left
usage after: 5-hour 77% left; weekly 42% left
notes:
  - worker reproduced missing attachment metadata on targeted refresh
  - implemented targeted attachment refresh with regression coverage
  - reported focused tests, 9 UI tests, and git diff --check passing
  - reported full offline suite 164 passed / 1 skipped, with 2 checks blocked by missing local .venv/bin/xt and setuptools
  - worker did not create its own commit before stopping; hidden grading still passed the resulting worktree
  - end-to-end runner wall time was about 8m21s
```


### Decision run #8 — thread-atlas-155 A, trial 1 — 2026-10-01

```yaml
task: thread-atlas-155
arm: A
trial: 1
model: gpt-6-luna
reasoning: max
run dir: /Users/perrystory/spot-runs/thread-atlas-155-A-t1-2026-10-01T14-01-58-088Z
session: a81ed86862083e06
passed: true
usage before: 5-hour 77% left; weekly 42% left
usage after: 5-hour 76% left; weekly 42% left
findings:
  - notes only: synthetic missing-file paths and one Library/Application path; no violations
notes:
  - implemented targeted attachment metadata ingestion plus fixtures for idempotency, multiple attachments, attachment-only messages, chat isolation, and missing media
  - focused tests: 22 passed
  - full suite: 163 passed, 1 skipped, 1 failure in installed-xt console-script environment check
  - git diff --check passed
  - no worker commit because the full repository checks were not all green
  - end-to-end runner wall time was about 3m52s
```

Paired result for `thread-atlas-155`, trial 1:
- Sol: PASS
- Luna: PASS
- This pair is a correctness tie on the most integration/repo-archaeology-heavy task sampled.
- Secondary wall-time signal: Luna completed in about 3m52s versus Sol about 8m21s.

### Pragmatic stopping point after decision run #8

The historical replay is stopped after four complete paired tasks / eight decision runs. This is an intentional operational stopping decision for a personal model-routing choice, not the original preregistered 24-run completion.

Observed paired correctness:
- `worklog-3`: Sol FAIL / Luna FAIL
- `vibecoding-status-web-12`: Sol PASS / Luna PASS
- `doordash-delivered-5`: Sol PASS / Luna FAIL
- `thread-atlas-155`: Sol PASS / Luna PASS

Thus Sol has one unique correctness win; Luna has none. The unique Sol win is a narrow but real canonical-identity integration miss by Luna. Thread Atlas, the sampled messy integration/archaeology task, is a tie.

Efficiency conclusions should use per-session token counts, recorded cost, and wall time. Quota percentages are retained only as account-pressure telemetry.


### Final eight-run telemetry closeout — 2026-10-01

```text
Arm A — Luna max
valid decision runs: 4
passes: 2
wall time: 646 s
recorded cumulative session cost: $0.285483

Arm B — Sol high
valid decision runs: 4
passes: 3
wall time: 1,665 s
recorded cumulative session cost: $6.327426
```

Observed aggregate efficiency ratios, Sol relative to Luna:
- wall time: 2.58x
- recorded cost: 22.16x

Token-counter correction:
- An earlier closeout incorrectly summed Crush's saved `prompt_tokens`, `completion_tokens`, and `total_tokens` fields and described the sums as token consumption.
- Current Crush source shows `session.Cost` is accumulated, while the token counters are replaced with the latest model step's usage. They are final context/output snapshots, not cumulative session spend.
- Therefore the prior “Sol used 1.34x total tokens” statement is withdrawn. The raw per-run snapshots remain useful for context-footprint diagnostics but are not aggregated as consumption.

Interpretation:
- Sol produced one additional hidden-test pass across the four paired tasks (3/4 vs 2/4).
- The only unique correctness win was doordash-delivered #5, a narrow but real canonical-identity integration miss by Luna.
- On thread-atlas #155, the most integration/repo-archaeology-heavy sampled task, both passed; Luna completed in 212 session seconds versus Sol's 474 seconds.
- The original preregistered easy/medium decision rule was not completed as designed: the historical replay stopped after four pairs rather than all 24 runs. Applying that rule mechanically to the partial easy/medium sample gives Sol 3 passes vs Luna 2, but that is not a completed preregistered-protocol result.
- For the personal production-routing decision, the closeout policy remains Luna first, normal Review Gate, one Luna repair for ordinary/local findings, then Sol escalation when a substantive correctness/integration failure persists or when Review Gate exposes a deep semantic/contract miss.
