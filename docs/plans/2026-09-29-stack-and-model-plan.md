# Stack and model plan — 2026-09-29

Durable record of the stack decisions and next steps worked out in the 2026-09-29
session. Chat transcripts get compressed and lost; this file is the reference.
Source classes follow STACK.md: (disk) read on the machine, (session) observed in
a session, (reported) stated but not independently checked.

## 1. Current stack

| Layer | What runs | Status |
|---|---|---|
| Planning / deep triage | ChatGPT web and Claude, as appropriate | Unchanged |
| Execution | Crush v0.96.1, interactive only (reported) | Replaced OpenCode + oh-my-opencode-slim |
| Large model (actually running) | `openai/gpt-6-luna`, `reasoning_effort: "max"`, as stored in `~/.local/share/crush/crush.json` (reported) | The picker overrides `model large` in crushrc, which still says `gpt-6-sol --reasoning-effort high`. A 2026-09-28 session still ran on `gpt-6-sol`, so the switch to Luna happened between 2026-09-28 and 2026-09-29. |
| Small model | `openai/gpt-6-luna`, medium, from crushrc (reported) | The data file stores no `small` entry, so crushrc decides. Not verified at runtime. |
| Billing | ChatGPT Plus, $20, Codex allowance; Claude Pro, $20 (reported) | Rolling 5-hour limits plus possible weekly caps on both |
| Review gate | Custom GPT in ChatGPT web, run manually (reported) | The review-gate poller is not in use |
| Coordination | GitHub issues, PRs, comments, check runs | Unchanged |
| MCPs | None | octocode disabled 2026-09-25 |
| Hooks | `PreToolUse` on bash: rtk-rewrite, dcg, jev-guard | Unchanged |
| Project memory | mex trial in thread-atlas (`messages`), `mex-inbox` loaded, `mex-relay` disabled | Trial running |
| Terminal | herdr | Adopted |

## 2. What was cut, and whether each cut was right

| Cut | Why | Verdict | Reverse if |
|---|---|---|---|
| octocode MCP (2026-09-25) | Its 3 tool schemas cost about 8.5k tokens on every request and it was called about once, ever. Crush's built-in grep, view and LSP tools cover the same ground. | Correct. The re-enable command is kept as a comment in crushrc. | An agent repeatedly fails at something only octocode did (for example, semantic lookups the LSP tool can't answer). |
| OpenCode as the execution harness | Moved to Crush. | Keep. The recovered `opencode.db` stays as a read-only archive (section 5). | — |
| `mex-relay` skill | A typed "handoff" was routed to mex Relays instead of the palette-only `handoff` skill. Relays are team features, and you work solo. | Correct and harmless: one config line. Starting `handoff` from the palette also avoids the conflict. | You start wanting mex team handoffs. |
| Crush auto-LSP | It started unwanted and duplicate servers found on PATH (`tvm_ffi_navigator`). | Correct. | — |

Nothing else has been cut.

## 3. Model decision

- **Default:** `gpt-6-luna` at Max, which is what is set now.
- **Escalation:** `gpt-6.1-sol` at high, released 2026-09-29. It is in Crush's picker (reported). Crush offers it low, medium, high, xhigh, max and ultra; Luna's highest level is max.
- **Escalation rule:** if the default model fails the review gate twice on an issue, discard its worktree and redo the issue on the escalation model from a clean checkout. Never hand the stronger model the weaker model's partial edits.

Why, with prices as of 2026-09-29 (reported; OpenAI pages not reachable from the session):

| Model | Input | Cached input | Output (per 1M tokens, context up to 272K) |
|---|---|---|---|
| `gpt-6-luna` | $0.10 | $0.01 | $0.50 |
| `gpt-6-sol` | $2.00 | $0.20 | $10.00 |
| `gpt-6.1-sol` | $2.00 | $0.10 | $10.00 |

- Codex credits equal the API price at $0.04 per credit, so these ratios carry straight over to Plus quota.
- For agent work, where cache reads dominate, Luna costs roughly 10–15× less than 6.1 Sol. That's an estimate.
- Published Plus limits per 5 hours: about 15–160 messages for 6.1 Sol and 350–3,000 for Luna. On Plus, Sol is the binding limit.
- The risk: 6.1 Sol is reportedly near Astra-level. A stronger model can finish in fewer turns and fewer review rounds, which narrows the per-task cost gap ("cheapest per token is not cheapest per task"). Section 4 exists to measure that on real tasks.

Claude / Opus 5.5 (reported, from a last30days summary, unverified): the research framing of Opus for planning, diagnosis and adversarial review, and Sol or Luna for implementation, maps directly onto Tracer's planning/review plane versus execution plane. No change now. Moving the review gate to Opus is a candidate for later (section 7), because changing the reviewer mid-measurement would confound review-round counts.

## 4. Evidence plan

Two parts. Neither needs scratch repos, CI or manual review-gate rounds.

### 4a. Hidden-test spot check (one-off, about 16 runs)

This answers the question the running log can't: on the same task, from the same base, does Luna's first attempt behave correctly as often as Sol's?

**Tasks** (leakage-screened: the issue was created before the first commit's author date):

| Tier | Task | Base SHA |
|---|---|---|
| Easy/medium | vibecoding-status-web #12 → PR #17 | `73a02a02acb3928cadfc778f315e57971d396a44` |
| Easy/medium | thread-atlas #149 → PR #168 | `5c74b5f346d8e32b1851191fced3de7a348b2f9b` |
| Easy/medium | thread-atlas #155 → PR #158 | `5c31b142556aef01bb7fb1b922f110692f9be7df` |
| Easy/medium | doordash-delivered #5 → PR #10 | `386634a7120c9e2f0f0d4a43cfdef09da443d240` |
| Hard | worklog #3 → PR #11 | `45f643c41457b0572f7ba5f3dab6fc9d7c238419` |
| Hard | thread-atlas #64 → PR #167 | `28d12cb39e2909892faf7ee58800c940c5c858e8` |
| Hard | doordash-delivered #4 → PR #11 | `83a375df786de4bce309537221b8e4b44a492712` |
| Hard | whatimeant #20 → PR #27 | `cb9f968aee9a86536a765a6c4121e120ed8e9405` |

Pilot (validates the setup; results discarded): tracer-workflow #71 → PR #73 at
`39a8cc1a93d13c7d92da15c32b6165321f5a1fe7`, and worklog #2 → PR #10 at
`a198b0cf58b0ea4e7df492e10f5455234e44b06b`.

Dropped for leakage (issue written after the implementation started):
- tracer-workflow #143, #99, #97 and #167
- thread-atlas #151 and #153

**Before any run:**
1. Map each merged PR's tests to the issue's acceptance criteria. Only tests that map to a criterion count toward grading. For each defect that historical review caught, note whether a hidden test covers it.
2. Record the `~/.config/crush` commit SHA, with a clean tree. Change nothing in the stack until the runs finish; this freeze lasts days, not weeks.
3. Confirm the exact stored model strings in `~/.local/share/crush/crush.json`.

**Arms:**
- A: `gpt-6-luna`, Max.
- B: `gpt-6.1-sol` at high.
- For each arm, set `small` to the same model as `large`, so subagents can't run on the other arm's model.

**Each run:**
1. Build the tree with `git archive <base>` plus a fresh `git init`, so there is no future history.
2. Put the issue body in `ISSUE.md`.
3. Use one fixed prompt for both arms: implement `ISSUE.md`, run the repo's own checks, stop when done.
4. Deny `fetch`, `agentic_fetch`, `download` and `sourcegraph`. Run with no `gh` authentication.
5. Scan the session's tool calls afterward (`crush session show <id> --json`) for any of the following. Any hit invalidates the run, and it is redone.
   - `gh`, `curl` or `git fetch`
   - hidden-test paths
   - any path inside the original repos. `~/Code/vibecoding/messages/.worktrees/issue-149`, `issue-155` and `issue-64` hold the historical implementations of three decision tasks, and Crush's view tool can read absolute paths.

**Grading:** copy in the in-scope hidden tests only after the run finishes, then run them. Grade the first attempt only; there is no repair loop.

**Record per run:**
- model string, from each assistant message's `model` field in the session JSON
- hidden-test pass/fail
- the repo's own checks
- wall time
- Codex usage readout before and after, with nothing else using the account in between
- Crush session `cost`, if prices are configured and the pilot showed it tracks the readout
- tool-call count: the number of `tool_call` parts in the session JSON
- whether the agent ran `mex`

Run in random order (write down the seed), alternating arms. One trial per task per arm.

**Decision rule, fixed now:**
- On the easy/medium tier, Luna must pass at least as many tasks as Sol. If it does, Luna stays the default. If not, Sol becomes the default and Luna goes back to the small slot only.
- The hard tier doesn't decide the default. Luna's failures there define when to escalate.

**What this gives up, deliberately:** review-loop dynamics (needs-fix rounds, review escapes) aren't measured here. That would cost 35–50 manual review-gate rounds. Section 4b measures review-loop cost on real work instead.

**Status 2026-09-30: ready to run.** The harness is `tooling/model-spot-check/` (see its README). Preparing it changed the protocol in five ways:

- **Interface disclosure.** The merged tests for five decision tasks assert module paths, function names, JSON keys or DOM hooks that the issue never names: thread-atlas #64, worklog #3, doordash-delivered #4 and #5, whatimeant #20. Both arms now get identical interface notes appended to `ISSUE.md` (`interfaces/<task>.md`). The notes give names and shapes, never expected results. Without them, a correct solution with different names would fail.
- **Shape-only tests excluded.**
  - doordash #5's third test regex-matches the reference implementation's exact source.
  - doordash #4's dialog test requires `setAttribute('role','dialog')` literally.
  - Neither is run.
- **Review-derived test reported separately.** doordash #4's map-geometry privacy test encodes the leak historical review caught. The issue text doesn't name geometry, so this test doesn't count toward pass/fail.
- **Out-of-scope PR edits.** whatimeant PR #27 also changed privacy-page copy. That test runs at its base version, and `ui-invariants.mjs`, which the PR rewrote, is not a grader.
- **Validation.** Every graded command passes on its PR head and fails on base plus hidden tests. The one exception is three thread-atlas tests that need DuckDB's `sqlite_scanner` extension, which DuckDB downloads on first use; `prepare` now pre-installs it.
- Also found: thread-atlas #149's first acceptance criterion (a hash on the run row) was already met at base, so the graded change is `raw_sources` population.

### 4b. Running log (ongoing, starts now)

For every issue finished, append one line to `docs/plans/model-log.md`:

`date | repo#issue | model | needs-fix rounds | accepted | human repair (y/n) | escalated (y/n)`

When anything in the stack changes, add a dated line to STACK.md. Review after about 20 issues. If Luna escalates often or needs noticeably more rounds, reconsider the default.

## 5. Telemetry

- `crush session show <id> --json` (reported, sample session from 2026-09-28) contains:
  - `meta` with `prompt_tokens`, `completion_tokens`, `total_tokens` and `cost`
  - every message, with a per-message `model` and `provider`, timestamps, and `tool_call` parts including their inputs
  - the skills loaded, with load times
- **Model, tool-call counts and wall time can be read from this record. No new hook is needed.**
- **What the `meta` fields mean**, from Crush source (`internal/agent/agent.go`):
  - `prompt_tokens` is the last request's context size (uncached input plus cache reads). It is overwritten every step and set to 0 by summarization.
  - `completion_tokens` is the last step's output.
  - `cost` accumulates across steps and includes subagent sessions.
- **How `cost` is priced:** the model's catalog prices. `cost_per_1m_in` and `cost_per_1m_out` price uncached input and output, `cost_per_1m_in_cached` prices cache writes, and `cost_per_1m_out_cached` prices cache reads. It is 0 if the provider has `flat_rate` set or the usage is estimated.
- **Your stored catalog lists $0 for every OpenAI model**, so current runs likely record $0. Check the newest Luna session's `cost`.
- **Optional, measurement-only change before the pilot:** set the prices for the three models under test in the OpenAI provider's `models` in crush.json. Short-context prices; the catalog's 272K context window means long-context rates never apply.

  | Model | `cost_per_1m_in` | `cost_per_1m_out` | `cost_per_1m_in_cached` (cache write) | `cost_per_1m_out_cached` (cache read) |
  |---|---|---|---|---|
  | `gpt-6-luna` | 0.10 | 0.50 | 0.125 | 0.01 |
  | `gpt-6.1-sol` | 2.00 | 10.00 | 2.50 | 0.10 |
  | `gpt-6-sol` | 2.00 | 10.00 | 2.50 | 0.20 |

  Crush issue #2649 reports custom model entries being overridden by the embedded catalog, so confirm with one short session that `cost` comes out non-zero. Then `cost` equals list-price-equivalent usage, and at $0.04 per credit it tracks Codex credits. In the pilot, compare it once against the Codex readout; if they disagree, the readout wins. Record the change in STACK.md.
- **Quota:** the Codex usage readout before and after each run.
- **Not now:** an OpenTelemetry trace pipeline. Build it only if counts can't answer a question that comes up.
- **OpenCode corpus** (`opencode.db`, recovered): keep it and back it up, as a read-only historical archive. Don't use it for model decisions: model, preset, plugin and workload changed together, so model comparisons from it are confounded.

## 6. Repository changes (one issue and one PR each, in this order)

1. **This commit:** this plan, a STACK.md entry for 2026-09-29, and RADAR entries (herdr adopted, mex in trial, Ponytail queued).
2. **Docs: separate the workflow protocol from the runtime.**
   - Add RUNTIME.md.
   - Make WORKFLOW.md, CONTEXT.md, AGENTS.md and `.agents/repo-context.md` tool-independent.
   - Move ORCHESTRATOR.md to `docs/history/`.
   - Add a non-normative banner to STACK.md.
   - Replace "lane" with "stage" where it means a workflow stage, in WORKFLOW.md and `skills/from-issue/SKILL.md`.
3. **Code: remove the hard OpenCode dependency.**
   - `tooling/doctor/doctor.ts` requires the `opencode` executable.
   - `tooling/review-gate-poller/poller.ts` calls `opencode run`.
   - The `oh-my-opencode-slim` managed block in `.gitignore`/`.ignore` and its test cover `.slim/`, OpenCode's worktree directory. tracer-workflow's current worktrees are sibling directories (`~/Code/tracer-workflow-<name>`), which need no ignore entry. So the block is a removal candidate, not a replacement, once `.slim/` is confirmed absent from the checkout. `messages` uses in-repo `.worktrees/` instead; tooling must not assume either layout.
4. **Workflow friction:** #35 (`tracer resume`, AFK), then #29 (native `blockedBy`), #30 (priority plus `next`) and #37 (cross-repo picker). Move the local `whatsnext` script into tracer-workflow as the starting point for #35.

## 7. Parked, with the condition to pick each up

| Item | Pick up when |
|---|---|
| Ponytail | After 4a. Rerun the same tasks with the chosen model, with and without it. |
| Review gate on Opus 5.5, or automated via `codex exec` / `claude -p` | After about 20 logged issues, as a single change with the log as its baseline. |
| Skill lifecycle framework (discover → classify → promote → evaluate → retire) | After item 3 in section 6. Pilot it on one repo. |
| OpenTelemetry trace pipeline | Only if counts can't answer a question that comes up. |
| gitmem / OKF Agent Memory | Reading only, as input if the instincts layer is rebuilt. Sources are unverified. |

## 8. Operating rule

One change at a time. Each change must name a problem it solves now. If a second change is proposed before the first has proven itself, ask "what breaks if I don't do this?" If the answer is "nothing yet," don't.

## 9. Answered on 2026-09-29 (reported)

1. `gpt-6.1-sol` is in Crush's picker.
2. The Luna arm is stored as `{"model":"gpt-6-luna","provider":"openai","reasoning_effort":"max"}`.
3. The session JSON includes the model and every tool call; `meta` token counts look like last-request values (section 5).
4. Claude plan: Pro, $20/month.
5. Worktrees: tracer-workflow uses sibling directories (`~/Code/tracer-workflow-<name>`); `messages` uses in-repo `.worktrees/`.
