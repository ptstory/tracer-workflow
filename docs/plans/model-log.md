# Model log

One line per finished issue. See `2026-09-29-stack-and-model-plan.md` section 4b.
Add a dated line to STACK.md whenever the stack changes.

| Date | Repo#issue | Model (from session header) | Needs-fix rounds | Accepted | Human repair | Escalated |
|---|---|---|---|---|---|---|

## Spot check (#182): setup

Recorded before the first decision run. Nothing in Crush changes until the last run is graded.

| Item | Value |
|---|---|
| Crush config | `ptstory/crush-config` @ `e32a32c4b5bd060733a3b12558abce8bf89cb03a` (branch `chore/skill-symlinks-20260930`, clean tree, pushed) |
| Skills content | `~/.agents/skills` {diagnosing-bugs, from-issue, from-pr-review, herdr, tdd}: 16 files, manifest SHA-256 `9d9e832fd721484683b86c0c4049525aa1f996743af560a6cace4e0d612e947c` (`~/crush-skills-manifest-20260930.txt`); re-check before `report` |
| Harness | `ptstory/tracer-workflow` @ `35b6a71`, run from worktree `~/Code/tracer-workflow-spot-check` |
| Crush | v0.96.1 |
| Price override | Skipped (`crush-prices.json` not merged); quota measured by the Codex usage readout only |
| Seed | _pending_ |
| Run order | _pending: paste `order` output_ |
