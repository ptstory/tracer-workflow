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
| Large model (actually running) | `openai/gpt-6-luna`, reasoning Max, set via the TUI picker (reported, screenshot) | The picker overrides `model large` in crushrc, which still says `gpt-6-sol --reasoning-effort high` |
| Small model | `openai/gpt-6-luna`, medium (reported, config only) | Not verified at runtime |
| Billing | ChatGPT Plus, $20, Codex allowance (reported) | Rolling 5-hour limit plus a possible weekly cap |
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
- **Escalation:** `gpt-6.1-sol` at high, released 2026-09-29, once it appears in Crush's picker. Until then, use `gpt-6-sol` at high.
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
- B: `gpt-6.1-sol` at high (or `gpt-6-sol` at high if 6.1 isn't in the picker; record which).
- For each arm, set `small` to the same model as `large`, so subagents can't run on the other arm's model.

**Each run:**
1. Build the tree with `git archive <base>` plus a fresh `git init`, so there is no future history.
2. Put the issue body in `ISSUE.md`.
3. Use one fixed prompt for both arms: implement `ISSUE.md`, run the repo's own checks, stop when done.
4. Deny `fetch`, `agentic_fetch`, `download` and `sourcegraph`. Run with no `gh` authentication.
5. Scan the session's tool log afterward for `gh`, `curl`, `git fetch` or hidden-test paths. Any hit invalidates the run, and it is redone.

**Grading:** copy in the in-scope hidden tests only after the run finishes, then run them. Grade the first attempt only; there is no repair loop.

**Record per run:**
- model string, confirmed from the header
- hidden-test pass/fail
- the repo's own checks
- wall time
- Codex usage readout before and after, with nothing else using the account in between
- completion tokens, if they're non-zero and plausible
- tool-call count, if Crush's session record exposes it
- whether the agent ran `mex`

Run in random order (write down the seed), alternating arms. One trial per task per arm.

**Decision rule, fixed now:**
- On the easy/medium tier, Luna must pass at least as many tasks as Sol. If it does, Luna stays the default. If not, Sol becomes the default and Luna goes back to the small slot only.
- The hard tier doesn't decide the default. Luna's failures there define when to escalate.

**What this gives up, deliberately:** review-loop dynamics (needs-fix rounds, review escapes) aren't measured here. That would cost 35–50 manual review-gate rounds. Section 4b measures review-loop cost on real work instead.

### 4b. Running log (ongoing, starts now)

For every issue finished, append one line to `docs/plans/model-log.md`:

`date | repo#issue | model | needs-fix rounds | accepted | human repair (y/n) | escalated (y/n)`

When anything in the stack changes, add a dated line to STACK.md. Review after about 20 issues. If Luna escalates often or needs noticeably more rounds, reconsider the default.

## 5. Telemetry

- What Crush gives: per-session `prompt_tokens`, `completion_tokens`, `total_tokens` and `cost` via `crush session show <id> --json` (reported).
  - A 2026-09-26 session showed `prompt_tokens: 0`, and `cost` comes from a static price table regardless of auth path (session). So `cost` does not measure quota. The Codex usage readout does.
- To verify: whether `crush session show --json` includes messages and tool calls. If it does, tool calls can be counted with no new code.
- Only if it doesn't: add one `PreToolUse` hook that appends `session_id`, tool name and timestamp to a JSONL file. Crush hooks don't fire inside subagents, so this is a floor, not a complete trace. Add it as its own change, not bundled with anything else.
- Not now: an OpenTelemetry trace pipeline. That is worth building only if the log or spot check raises questions that counts can't answer.
- OpenCode corpus (`opencode.db`, recovered): keep it, and back it up. Treat it as a read-only historical archive. Don't use it for model decisions: model, preset, plugin and workload changed together, so model comparisons from it are confounded.

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
   - The `oh-my-opencode-slim` managed block in `.gitignore`/`.ignore` and its test need Crush's worktree directory. Needed: the output of `git worktree list` from a repo where Crush made a worktree.
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

## 9. Open questions

1. Is `gpt-6.1-sol` in Crush's picker yet?
2. What exact string does `~/.local/share/crush/crush.json` store for Luna's effort?
3. Does `crush session show --json` include tool calls, and is `prompt_tokens` still 0?
4. Which Claude plan are you on? This affects when moving the review gate to Opus is worth trying.
5. What is Crush's worktree directory? Needed for item 3 in section 6.
