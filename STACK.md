# STACK.md

Durable append-only record of agent-stack configuration changes and breakage findings, because diagnoses that live only in chat transcripts get re-derived from scratch weeks later.

## 2026-08-20

No config changes. Audit only.

Findings:
- thirty-lite is now the loaded preset. Every session log since 2026-08-18
  reports `health check passed {"agents":7,...}`, matching thirty-lite's nine
  seats minus the two disabled_agents (designer, observer). The "openai" preset
  would report 6. No log line states the preset name; seat count is the only
  available signal.
- The orchestrator unfencing is only half-applied. thirty-lite's orchestrator
  `mcps` array is an allowlist, not a modifier list — the `"*"` in the "openai"
  preset's orchestrator entry proves it. Removing `!serena` and `!chisel` on
  2026-08-12 did not grant those servers. Session logs report `mcps: 1` for
  that seat. `ast_grep_replace` and `serena_replace_content` also remain `deny`
  in the opencode.json permission block. Do not describe the orchestrator fence
  as "off".
- The two orchestrator changes landed on different dates and are separable.
  The permission flip (edit/bash to allow) lives in opencode.json under
  agent.orchestrator, which is not preset-scoped; that file's birth time is
  2026-08-12 03:08 EDT, so it took effect immediately. The model change to
  openai/gpt-5.4 lives in the preset and did not take effect until thirty-lite
  began loading on 2026-08-18.
- Before 2026-08-18 the orchestrator was not gpt-5.4-mini. The "openai" preset
  was loading, whose orchestrator is openai/gpt-5.5-fast at high variant with
  `mcps: ["*"]`. Any July or early-August comparison framed as "mini as
  orchestrator" is mislabelled.
- The oh-my-opencode-slim `[v2]` bridge failures are benign. The v2 path is a
  compatibility shim that re-registers v1 hooks onto ctx.tool.transform,
  ctx.session.hook, ctx.tool.hook and ctx.event.subscribe, none of which this
  OpenCode build exposes, so all five throw. It writes its own ~1.6 KB log
  while the v1 path registers natively alongside it. Verified: of the log files
  containing `event.subscribe failed`, zero also contain task-session-manager
  activity. Do not re-diagnose this as a defect.
- OH_MY_OPENCODE_SLIM_PRESET is exported inside the `ocslim` shell function,
  not at shell scope, so `env` shows nothing outside it. `ocslim` also unsets
  OPENCODE_CONFIG, OPENCODE_CONFIG_DIR and OPENCODE_CONFIG_CONTENT; a bare
  `opencode` invocation does not. Both currently resolve to thirty-lite because
  oh-my-opencode-slim.json defaults to it.
- serena appears to have renamed a tool: `serena_replace_content` (July) is
  absent in August, replaced by `serena_replace_in_files`. The opencode.json
  orchestrator permission block still denies the old name.
- Unexplained: since 2026-08-18 the orchestrator seat shows one
  `serena_initial_instructions` and one `ast_grep_search` call despite
  reporting a single MCP. Either a session ran under a different preset, or the
  allowlist reading above is incomplete.

Telemetry notes (opencode.db):
- `session.cost` is populated only for opencode-go rows. Every openai seat
  reports 0.00 — the gpt-5.4 orchestrator shows $2.75 against 107M input
  tokens. Flat-rate auth writes no price. Cost comparisons cannot be made from
  this column. Tokens are the only comparable currency.
- The largest single group in `session` is agent NULL / model NULL: 1,521
  sessions, 226M input tokens. `oracle` shows one session across all history
  while plugin logs show oracle subagents dispatching and completing normally,
  so oracle work lands in the NULL bucket. All per-seat counts are floors.
- `count(distinct session_id)` over `part` counts subagent spawns, not
  sittings: each `task` call creates a child session, and through July the
  daily session count and task count are the same number.
- Unordered `LIMIT n` sampling of `part` returns the oldest rows and produced a
  false "serena and chisel have never been used" reading. Always bound `part`
  queries by time_created.

Utilization, as share of tool calls:
- July (~36k calls): task 6.9%, magic context (ctx_*) ~3.7%, serena ~0.27%,
  chisel ~0.21%, ast_grep 0.14%.
- 2026-08-18 onward (~1.9k calls): serena 1.9%, task 1.7%, magic context 1.5%,
  chisel 0.3%, ast_grep 0.3%.
- Per-seat since 2026-08-18: orchestrator bash 471, read 234, skill 115,
  apply_patch 39, task 31. fixer read 157, apply_patch 116, bash 99,
  serena_replace_in_files 14, ast_grep_replace 5. explorer light recon only.
  executor, oracle and council near-empty.
- Delegation ratio (task calls per distinct session per day) held at ~0.97-1.0
  through 2026-08-11, then broke: 0.86 on 08-12, 0.70 on 08-14, no recovery.
  It tracks the permission flip, not the model change.

Confounds:
- August work has been tracer-workflow itself — git, gh, skill and prompt files
  — which is bash-heavy and delegation-light regardless of seat config. Bash
  per session was already climbing before 08-12 (~2.9/day mid-July, 6.4 on
  08-07, 8.8 on 08-08). The delegation drop is part fence, part workload, and
  the two are not separable from this data.
- August volume is thin: the largest August day is 1,431 tool calls against
  07-15's 7,862.

E5 impact:
- The 08-12 / 08-18 split means the post-08-18 window is not a clean
  single-variable change either — the fence had already moved. No attributable
  window exists for the model change alone.
- Open and unanswered: whether delegating to fixer beats the orchestrator doing
  the work itself. Re-run the per-seat and daily-ratio queries on
  non-tracer-workflow code before concluding anything.

## 2026-08-18

Findings and changes:
- oh-my-opencode-slim plugin entry in opencode.json was unversioned and resolved
  against @latest, re-resolving at OpenCode startup. Cache showed 2.0.5
  (Jun 25) and 2.2.15 (Aug 18). Now pinned to 2.2.15.
- OH_MY_OPENCODE_SLIM_PRESET was exported as "thirtydollars" from the ocslim
  function in ~/.zshrc. No preset by that name exists. slim fell back silently
  to the "openai" preset, so every session ran GPT-5.6 Luna Fast at medium
  variant — not thirty-lite. Corrected to thirty-lite.
- The August change moving the thirty-lite orchestrator to openai/gpt-5.4 at
  high variant was written to the config correctly but never executed, because
  thirty-lite was not the loaded preset.
- qmd MCP command pointed at /Users/perrystory/.bun/bin/qmd; the binary had
  moved to /opt/homebrew/bin/qmd. Path corrected.
- serena MCP was invoked as a bare command; changed to an absolute path. That
  was not the cause of its failure — see below.
- serena's uv tool environment was orphaned: the shim at ~/.local/bin/serena
  pointed at a missing interpreter
  (~/.local/share/uv/tools/serena-agent/bin/python3). Fixed with
  `uv tool install serena-agent --reinstall`; now serena-agent 1.7.0.
- ledger MCP entry pointed at a pruned git worktree; the built entry point does
  not exist. Entry removed.
- Plugins @slkiser/opencode-quota and @kagan-sh/kagan were also unversioned.
  Pinned to 3.10.1 and 0.4.0.

E5 impact:
- Evidence collected between 2026-06-25 and 2026-08-18 was gathered against a
  plugin version that drifted with no version stamps on sessions, under the
  "openai" preset rather than the thirty-lite preset under test, and with serena
  non-functional for at least part of the window. serena feeds the orchestrator,
  explorer, and fixer seats in thirty-lite, so those lanes fell back to raw file
  reads. Attribution is not recoverable from this window.

## 2026-07-29

Findings recorded at the time. All four remained unfixed until 2026-08-18:
- ledger MCP pointed at a pruned worktree.
- serena failing to start due to an orphaned uv-managed venv interpreter;
  PATH was explicitly ruled out.
- qmd MCP had a stale hardcoded ~/.bun/bin path.
- oh-my-opencode-slim version skew: ~/.config/opencode/package.json pinned
  ^1.0.4 with a stale node_modules install at 1.0.4, while the running TUI was
  2.2.8.
- NORTH_STAR.md, revised 2026-07-23, was confirmed absent from disk anywhere
  under ~/Code. The document governing stage sequencing is lost.
