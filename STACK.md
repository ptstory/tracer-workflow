# STACK.md

Durable append-only record of agent-stack configuration changes and breakage findings, because diagnoses that live only in chat transcripts get re-derived from scratch weeks later.

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
