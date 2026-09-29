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

## mattpocock/sandcastle — 2026-09-11
- Source: mattpocock/sandcastle (MIT, TypeScript library orchestrating sandboxed coding agents via sandcastle.run(); Docker/Podman/Vercel sandbox providers; agent providers for claude-code, codex, pi, cursor, opencode, copilot).
- Claims: per-run sandbox isolation with three branch strategies (head, merge-to-head, branch); schema-validated structured output extracted from a tagged stdout block with bounded retry that resumes the same session; a split between idle timeout before a completion signal and a grace timeout after it so commits survive a hanging agent process; prompt files with {{KEY}} substitution and !`command` expansion where substituted values are inert; sandbox.exec() for harness-run verification between agent runs.
- Verdict: take-the-idea
- Reason: the library assumes a TypeScript harness is the coordination bus, which conflicts with tracer-workflow's GitHub-as-bus design, and opencode is on its non-resumable provider list so the structured-output retry and session fork do not run against the current execution seat. The mechanisms are portable independently of the library.
- Taken: nothing yet — four mechanisms logged for later evaluation against the verdict contract parser, the AFK dispatcher in #40, prompt interpolation in from-issue/agent-brief, and the gate-readiness workflow.

## senior-dev persona skill, name forgotten — date unknown
- Source: recovered from memory
- Claims: details to be filled from chat archaeology.
- Verdict: undecided
- Reason: not yet researched — recovered from memory, details to be filled from chat archaeology.
- Taken: nothing

## herdr — 2026-09-29 adopted
- Source: friend running Ghostty + herdr; supersedes the 2026-08-27 trialing entry.
- Claims: agent-aware terminal runtime; persistent background server, per-pane working/blocked/idle state, ssh reattach, agent-drivable CLI.
- Verdict: adopted
- Reason: in daily use and no longer considered a trial. The earlier open question about the goal plugin auto-continuing on idle is moot, because that plugin was OpenCode-only and OpenCode no longer executes work.
- Taken: herdr as the terminal runtime. The earlier entry's follow-up still applies: ocs PR #1 and branch feat/initial-cli are candidates to close.

## mex — 2026-09-26
- Source: https://github.com/mex-memory/mex, v0.8.2
- Claims: repo-resident Markdown project memory shared through Git; local rebuildable SQLite indexes; tree-sitter code graph with CLI queries; wiki claims grounded to code symbols with drift flags; FTS only, no vector search; MCP server unpublished; telemetry on by default.
- Verdict: undecided, in trial
- Reason: trialing graph, wiki and grounding in thread-atlas (PR #166). The blocking questions are whether Crush invokes `mex` unprompted across about 10 sessions, and whether drift flags are mostly real. `mex-relay` is disabled in Crush because typed "handoff" was routed to Relays.
- Taken: trial setup only; `mex-inbox` loaded.

## Ponytail — 2026-09-29
- Source: https://github.com/DietrichGebert/ponytail, v4.10.0, via a last30days summary (not independently verified)
- Claims: a decision ladder (don't build → reuse → stdlib → existing dependency → minimal new code) that reduces generated code. Project benchmark: about 54% less code on 12 tasks. A JetBrains test on 80 paired tasks reported about 15% less code and 10% lower cost, with no detectable quality difference.
- Verdict: undecided
- Reason: it changes code volume and iteration count, which the model spot check measures, so adding it before that would confound the model comparison. No Crush adapter is listed; it may load as a plain skill (unverified).
- Taken: nothing yet. Queued after the model spot check, to be tested with and without it on the same tasks.
