This file is append-only.
Entries are never edited or deleted.
A one-line entry is a valid entry.
Candidates enter here before they enter the stack.

## mitsuhiko/gh-issue-sync — 2026-08-27
- Source: direct link
- Claims: syncs GitHub issues to local markdown for offline batch editing.
- Verdict: skip
- Reason: batch refinement is its value and issue authoring runs in ChatGPT web, which has no filesystem access; on push it silently creates missing labels, which would worsen existing label-vocabulary drift; comments are write-only so the comment-based verdict contract state is not mirrored; does not touch PRs.
- Taken: nothing yet — the parent/blocked_by/blocks front matter plus temp-ID reference rewriting is the one piece worth revisiting if issue authoring ever moves onto a local seat.

## LilMGenius/paperthin — 2026-08-27
- Source: direct link
- Claims: 28 low-level agentic design-pattern skills, agent-agnostic, auto-updating install.
- Verdict: take-the-idea
- Reason: the nba skill duplicates the unformalized project-cockpit pattern; its state reader is bound to paperthin's own re0-plan/re0-loop cycle folders, so only its rules transfer; global auto-updating symlinked skills repeat the unpinned-plugin failure mode that cost the Jun-Aug measurement window; hate/shower/catchup/re0-memo overlap review-gate, $handoff and the instincts layer.
- Taken: nba's contract — one action not a menu, cite the state read, name the avoided move, observable done-when — to be ported against gh state.

## herdr — 2026-07-31 seen, 2026-08-27 trialing
- Source: friend running Ghostty + herdr
- Claims: agent-aware terminal runtime; persistent background server, per-pane working/blocked/idle state, ssh reattach, agent-drivable CLI.
- Verdict: undecided, in trial
- Reason: pane state duplicates what ocs was reframed around, at the multiplexer layer instead of AppleScript plus a plugin JSONL; ssh reattach addresses the standing want to steer a blocked agent from a phone. Open question: whether a session running the goal plugin, which auto-continues on idle, ever registers as blocked.
- Taken: pending trial outcome. If pane state works, ocs PR #1 and branch feat/initial-cli get closed.

## caveman — date unknown
- Source: recovered from memory
- Claims: details to be filled from chat archaeology.
- Verdict: undecided
- Reason: not yet researched — recovered from memory, details to be filled from chat archaeology.
- Taken: nothing

## senior-dev persona skill, name forgotten — date unknown
- Source: recovered from memory
- Claims: details to be filled from chat archaeology.
- Verdict: undecided
- Reason: not yet researched — recovered from memory, details to be filled from chat archaeology.
- Taken: nothing

## caveman — 2026-09-08
- Source: github.com/JuliusBrussee/caveman
- Claims: skill cuts ~65% output tokens; proxy reports 33.2% fewer provider-reported input tokens (benchmark_counterfactual, 54-run pinned Claude Code); pixel mode −79% on dense slabs; wraps opencode via env without touching opencode.json; MIT skill, BSL-1.1 engine.
- Verdict: skip (skill), undecided (proxy).
- Reason: output tokens are 0.86% of weekly load (7.2M of 836.5M, week of 2026-09-08) and the skill adds ~1–1.5k input per turn, so the skill is net-negative on this stack by its own arithmetic. The proxy targets input, which is where the cost actually is, but it is lossy context compression behind recovery handles — the same class of intervention already opted out of four times in this config (compaction.auto, compaction.prune, preemptive-compaction, context-window-monitor). caveman learn duplicates CodeBurn. Blocking question: whether the four compaction opt-outs were reasoned or inherited.
- Taken: nothing.

## ponytail — 2026-09-08
- Source: github.com/DietrichGebert/ponytail
- Claims: −54% LOC, −22% tokens, −20% cost, −27% time, 100% safe against a no-skill baseline; n=4, 12 feature tasks, Haiku 4.5, headless Claude Code on full-stack-fastapi-template; MIT; opencode install is one plugin array entry.
- Verdict: undecided.
- Reason: benchmark ran on Haiku 4.5 while this stack is entirely GPT-5.x, and the README states a terse reasoning model deliberating the ladder can go the other way, naming GPT-5.5 as a case where it does — reasoning is the largest part type in opencode.db at 201,643, above tool at 169,063. Injects its ruleset into every subagent every turn by default; PONYTAIL_SUBAGENT_MATCHER scopes it. Targets code volume, while Coding was 7% of the 30-day OpenCode cut against Exploration at 45%. Blocking question: does the LOC reduction survive on GPT-5.x, and does it survive scoped off the read-only seats.
- Taken: nothing.
