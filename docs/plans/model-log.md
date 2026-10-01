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
| Price override | Skipped (`crush-prices.json` not merged); quota measured by the Codex usage readout only |
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
