# tracer doctor

Read-only workflow/configuration drift diagnostics.

## Usage

```bash
bun tooling/doctor/doctor.ts [--json] [--repo-root <path>] [--repo-root <path>] [--home <path>]
```

## Exit codes

- `0` — clean run or warnings only
- `1` — one or more hard contract errors
- `2` — invalid arguments or other CLI failure before a report is produced

## First-slice checks

- `skills/next/SKILL.md` still describes the `next` role
- `~/.agents/skills/next` resolves to the canonical repo skill directory (not the current worktree copy)
- `AGENTS.md` / `WORKFLOW.md` repo contract pointers are present
- `skills/review-gate/references/verdict-contract.md` still carries the marker contract
- GitHub repo access is checked read-only via `git remote.origin.url` + `gh label list`
- canonical GitHub labels are present when the repo is reachable
- installed `~/Library/LaunchAgents/*.plist` jobs still point at canonical tracer-workflow checkout scripts
