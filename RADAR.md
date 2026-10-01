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

## Necmttn/ax — 2026-08-23 seen, 2026-09-26 decided
- Source: webfuse-com/awesome-autoresearch list; github.com/Necmttn/ax (AGPL-3.0-only with a separate commercial license; TypeScript + Bun, embedded DuckDB graph plus SQLite sidecar, Effect pipeline; 104 stars on 2026-09-26).
- Claims: local-first ingest of Claude Code, Codex, Pi, Omp, OpenCode and Cursor sessions plus local git history and GitHub PRs; ships as skills plus an MCP server; `ax project context --json` before work and `ax project verify --json` before reporting done; typed hook authoring for Claude Code and Codex; accepted proposals get verdicts (adopted, ignored, regressed, partial) at +3, +10 and +30 sessions per project.
- Verdict: adopt, as the ingest, storage and measurement layer under the retro-learnings instincts work.
- Reason: the per-proposal verdicts are the measurement retro-learnings never had. No Crush support upstream, and the execution seat is Crush; a local Crush reader matched a real project database exactly. ax's own session-context step runs only when the agent calls it, the pull shape that went unused under OpenCode, so push injection (a Crush PreToolUse hook returning `context` once per session) stays in retro-learnings. No ax code is copied into retro-learnings because of the AGPL. Full record: ptstory/retro-learnings DECISIONS.md, 2026-09-26.
- Taken: local spike branch `spike/crush-ingest` (commit 49484f1, not pushed): 89/89 sessions, 3,587/3,587 tool calls, 97/97 errors and 33/33 subagent links against one project's `crush.db` on 2026-09-24. No Crush issues or PRs on Necmttn/ax as of that date. Frozen-copy parity and the injection hook are still to do.
