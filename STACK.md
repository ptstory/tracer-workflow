# STACK.md

Durable append-only record of agent-stack configuration changes and breakage findings, because diagnoses that live only in chat transcripts get re-derived from scratch weeks later.

## 2026-08-30

No config changes. Telemetry only.

Findings:
- Seat token distribution, all history, input tokens: orchestrator 280.0M / 890
  sessions, NULL 226.7M / 1521, executor 89.1M / 2984, fixer 88.4M / 1090,
  oracle 21.3M / 520, explorer 13.7M / 250. 724.9M total. (disk)
  Orchestrator is 38.6 percent of input tokens at 315k per session, about 10x
  executor. Executor is 41 percent of sessions and 12 percent of tokens.
- The NULL bucket resolves into two populations. (disk) 1333 children (54.4M)
  are lost subagent identity, recoverable via parent_id. 188 roots (172.3M,
  917k each) are pre-instrumentation: 115 in 2026-04, 71 in 2026-05, 2 in
  2026-07, none since. The agent column began being written around 2026-06.
  105 of the 188 carry a patch part, so these are ordinary large sessions, not
  zero-output failures. Seat-aware metrics can only run from 2026-06 forward.
- New telemetry grain: part.data type step-finish carries
  `{tokens:{total,input,output,reasoning,cache:{write,read}}}` with cost always
  0 — the per-call grain. (disk) part.data type patch carries a hash and
  `files[]` and marks a model step that changed the filesystem.
- Patch-hash resolution: the patch part hash is a git tree object, not a
  commit. (disk) Verified by `cat-file -t` against the bare per-project
  snapshot store under `~/.local/share/opencode/snapshot/`. So "changed step"
  means a model step with a non-empty patch part, and
  `sum(json_array_length(files))` counts file-step touches within a changed step
  rather than individual edit operations.
- Caveat: a patch part records any filesystem mutation in the step, including
  shell writes, so it overstates edits on bash-heavy seats. (disk)

Corrections to prior records:
- The 2026-08-20 entry line "oracle shows one session across all history"
  names the wrong failure mode. (disk) Oracle has 520 sessions and 21.3M input
  tokens; exactly one carries a nonzero cost. The original line was almost
  certainly written from a cost-filtered query. Per-seat counts are still floors
  for the child-NULL reason, but not for the reason recorded there.
- The 2026-08-20 utilization shares are stale. (disk) That post-08-18 window
  was ~1.9k tool calls when written and now holds 6,995 tool parts. Re-run
  before citing.

Cost per changed step, window 2026-08-18 onward:
- Input Mtok per changed step: fixer 0.028 (34 sessions, 3.4M, 120 patches),
  orchestrator 0.117 (72 sessions, 12.8M, 109 patches), executor 0.350 (49
  sessions, 2.1M, 6 patches), explorer 0.667 (27, 2.0M, 3). (disk) Fixer is
  4.2x cheaper per changed step than the orchestrator, and the shell-inflation
  caveat widens rather than narrows that gap.
- Not established: edit equivalence, selection effects on which work reaches
  the orchestrator, dispatch overhead. (disk) This window is thin and is
  tracer-workflow work, which the 2026-08-20 entry already flags as bash-heavy
  and delegation-light. Re-run attempted; it did not produce a denominator; see
  scoped re-run subsection below.

Scoped re-run, attempted 2026-08-30:
- Seat metrics above were computed with no project filter. (disk)
  session.project_id exists with a foreign key to project, and
  session.directory is indexed. Any seat metric without project_id in the
  WHERE clause pools every project.
- About 25 synthetic projects exist under
  ~/.local/state/tracer/model-routing-audit/ (route-A/B/C x task-1/9/11 x
  work-v2/v3/v4). (disk) These are benchmark-harness runs, not real work. They
  fall outside the post-08-18 window but are present in all-history cuts and
  must be excluded there.
- In the post-08-18 window, tracer-workflow is the largest single project at 60
  of 195 sessions, 31 percent. (disk) The pooled table above is more
  self-referential than the 2026-08-20 bash-heavy caveat implies.
- session.summary_additions, summary_deletions, summary_files and summary_diffs
  are not an alternative denominator. (disk) All 195 sessions in the window
  are non-null on the first three only because the column default is 0, and
  every value is 0; summary_diffs is null throughout. Patch parts remain the
  only denominator.
- The re-run on the messages project could not be completed. (disk) That
  project has 1,306 patch parts spanning 2026-04-23 to 2026-08-26,
  second-highest in the database, but exactly one after 2026-08-16. On
  2026-08-27 it ran 28 sessions across five seats with 54 fixer apply_patch
  calls and 11 orchestrator apply_patch calls, and produced zero patch parts.
  Other projects kept emitting through the same dates. Cause unknown — tracked
  separately. Seat cost per edit cannot currently be scoped to that project,
  and the pooled table is blind to it.

Process note:
- This session re-derived four findings already recorded in STACK.md before
  anyone read it. (session) Read STACK.md before diagnosing, not after.

## 2026-08-26

Entry format note: each finding below carries a source class — (disk) verified
by reading the file on this machine, (session) observed in a session
transcript, (reported) stated but not independently checked. Claims of class
(reported) should be re-verified before being used as a premise. See
tracer-workflow issue on recorded-state freshness.

Failure observed:
- Three OpenCode sessions on one implementation task (displacement pipeline in
  the messages repo) produced zero code. (session) Session 1: an implementation
  prompt with acceptance criteria ran 971,231 tokens and 3,390 seconds, then
  marked its own goal unmet with the blocker "planning-only/not the executor"
  and emitted a handoff spec. Session 2: that spec was re-fed and became a
  build checklist written to docs/superpowers-optimized/plans/ inside the
  product repo. Session 3: a docs-only AGENTS.md append — which that repo's own
  policy marks as DO: — loaded three skills before touching anything.

Root cause:
- superpowers-optimized loads via a registered OpenCode plugin at
  ~/.config/opencode/plugins/superpowers-optimized.js, symlinked into the clone
  at ~/.config/opencode/superpowers. (disk) Its
  experimental.chat.system.transform hook pushes lib/compact-bootstrap.js into
  the system prompt on every request, wrapped in EXTREMELY_IMPORTANT. That
  bootstrap carried a workflow router with the rows "Complex/unclear decision
  -> deliberation -> brainstorming -> writing-plans" and "New behavior
  (well-framed) -> brainstorming -> writing-plans", plus a complexity
  classifier ending in "Full — everything else, or when in doubt".
- Skill trigger conditions were not the loader. (disk) Nothing under
  ~/.config/opencode invokes using-superpowers; every grep hit is inside the
  bundle or its .bak twin. Moving skill directories would have left the router
  injected and pointing at absent skills.
- No config on this machine states "planning-only" or "not the executor".
  (disk) The model coined that phrase to describe the state brainstorming's
  hard gate ("Do not write code, edit files, or invoke implementation skills
  until design approval is explicit") and writing-plans' terminal handoff
  question had already put it in.

Changes applied 2026-08-26 (all in ~/.config/opencode/superpowers):
- lib/compact-bootstrap.js: replaced the complexity classifier and the planning
  rows of the router with an implementation-is-default rule stating that a plan,
  spec, checklist, ticket set, or handoff document is not a substitute for
  implementation and does not close the task, plus an explicit line that
  premise-check, deliberation, brainstorming, writing-plans,
  subagent-driven-development and executing-plans load only when the user names
  one. Kept the debugging, refactoring, performance, dependency, worktree,
  branch-integration and verification rows.
- Six SKILL.md descriptions rewritten to opt-in: using-superpowers,
  brainstorming, writing-plans, premise-check, deliberation, executing-plans.
  These matter independently of the bootstrap because the skill tool exposes
  descriptions to the model. using-superpowers previously read "BLOCKING
  REQUIREMENT — invoke this skill BEFORE writing any code"; premise-check read
  "Invoke BEFORE designing, planning, or building anything non-trivial".
- writing-plans output path moved from docs/superpowers-optimized/plans/ to
  docs/plans/. The old path is the fork's own internal convention and was being
  created inside whatever product repo happened to be open.

Side effects of those edits:
- The plugin auto-updates: it runs git fetch plus merge --ff-only origin/main
  every 24 hours, gated on a cache file. (disk) The clone sat at b78fc17
  because REPOZY/superpowers-optimized is dead, not because it was pinned. The
  plugin skips updating when the clone is dirty, so these edits now pin it as a
  side effect. `git checkout .` in that directory reverts everything above and
  re-arms auto-update.
- The same plugin runs a tool.execute.before safety layer blocking rm -rf ~,
  git reset --hard, git clean -f, curl piped to shell, reads of .env and
  private keys, and writes containing hardcoded AWS/GitHub/Anthropic/Stripe
  keys. (disk) Removing the plugin outright would remove that too. Editing the
  bootstrap keeps it.

Verification:
- (session) 2026-08-26 13:50, after OpenCode restart, the same implementation
  prompt run unprefixed: using-superpowers, brainstorming, writing-plans,
  premise-check and deliberation did not fire. token-efficiency did not preload
  either, since it was step 1 of the entry sequence that no longer runs. The
  session loaded using-git-worktrees (the prompt asked for a worktree) and
  test-driven-development, both retained router rows, created branch
  codex/displacement with a worktree at .worktrees/displacement, and dispatched
  an implementation brief — first state change roughly four minutes in.

Corrections to prior records:
- A handoff doc recorded a superpowers vendoring PR into
  tracer-workflow/skills/vendor/ that never happened; skills/vendor/ does not
  exist on main. (disk) That false line propagated through several sessions.
  De facto, the runtime clone is now a fork owned locally, since upstream is
  dead and the edits above are local-only.
- agent-failure-recovery is a standalone directory under
  ~/.config/opencode/skills/ dated 2026-06-06, not part of the superpowers
  bundle. (disk) AGENTS.md files that invoke it by name are unaffected by
  anything done to superpowers.
- ~/.codex/superpowers is a second, different bundle: real obra/superpowers
  v4.1.1, 14 skills. (disk) Codex runs upstream; OpenCode runs the dead fork.
  Nothing above touches the Codex side.

E5 impact:
- 2026-08-26 is another window boundary. Every session before this date routed
  through the planning-first bootstrap; every session after does not. Do not
  compare delegation, retriesPerEdit or oneShotRate across it.
- Sessions producing zero edits are currently invisible to costPerEdit — they
  either divide by zero or dissolve into an aggregate. The 971k-token session
  above is the most expensive single failure recorded in this log and would not
  appear in any current metric. Count zero-artifact sessions separately. This
  is the measurement E2 already defers pending "orchestrator input tokens per
  completed task" — same blind spot, empty denominator.

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
