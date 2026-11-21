# tracer doctor

Read-only diagnostics for workflow and configuration drift.

## Usage

```bash
bun tooling/doctor/doctor.ts [--json] [--repo-root <path>] [--repo-root <path>] [--home <path>]
```

## Exit codes

- `0`: clean run or warnings only
- `1`: one or more hard contract errors
- `2`: invalid arguments or another CLI failure before a report is produced

## First-slice checks

- `skills/next/SKILL.md` still describes the `next` role
- `~/.agents/skills/next` resolves to the canonical repo skill directory rather
  than the current worktree copy
- `skills/no-ai-slop/SKILL.md` and its Humanizer reference stay repo-owned
- `~/.agents/skills/no-ai-slop` resolves to the canonical repo skill directory as
  current-head activation evidence
- `AGENTS.md` / `WORKFLOW.md` repo contract pointers are present
- `skills/review-gate/references/verdict-contract.md` still carries the marker
  contract
- GitHub repo access is checked read-only with `git remote.origin.url`,
  `gh label list`, and the complete `gh pr list --state open` inventory
- canonical GitHub labels are present when the repo is reachable
- every open non-draft PR body contains exactly one recognized `Fixes`, `Closes`,
  or `Resolves` reference to an in-repository issue, corroborated by GitHub's
  closing-issue data; each issue has at most one open non-draft implementation PR
- draft PRs are excluded from active binding checks
- installed `~/Library/LaunchAgents/*.plist` jobs still point at scripts in the
  canonical tracer-workflow checkout
