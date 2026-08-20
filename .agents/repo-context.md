# Repo Context

## Project purpose

`tracer-workflow` defines an issue-backed, PR-mediated, evidence-first AI coding
workflow. It keeps GitHub issues, pull requests, commits, comments, and check
runs as the durable coordination layer instead of relying on chat transcripts.
The repository contains the canonical custom skills, reusable prompts, and Bun
tooling for triage, issue execution, review gates, review return passes, and
unbacked-work monitoring.

## Current source of truth

- `WORKFLOW.md` — canonical workflow, evidence-bundle contract, slice-contract
  rule, check-run gate, HITL/AFK rules, and stage responsibilities.
- `README.md` — repository overview, workflow diagram, skills, and tooling map.
- `skills/` — canonical source for Tracer custom runtime skills.
- `prompts/` — canonical plain reusable prompts.
- GitHub issues, pull requests, comments, and check runs — authoritative durable
  coordination artifacts.
- `project-map.md` — repository orientation map; update only when its contents
  become stale.
- `docs/` and `docs/adr/` are not present. TODO: add ADR or project-board links
  if the repository adopts them.

## Standard workflow

- Work from one GitHub issue at a time.
- Treat `WORKFLOW.md` and the issue/PR artifacts as the execution contract.
- Inspect `git status` before editing and keep changes small and reversible.
- Use `from-issue` for one `ready-for-agent` issue and one PR with a closing issue
  reference plus an evidence bundle.
- Use a fresh-session review gate; verdicts are valid only for their reviewed
  head SHA.
- Use `from-pr-review` for the return leg; delegate judgment to
  `receiving-code-review`.
- Do not merge from an agent workflow; merge stays manual unless the issue's AFK
  authorization explicitly permits it and the current check-run gate is green.
- Do not close parent issues unless explicitly requested.

## Standard commands

```bash
# Run the repository's Bun tests (test files use bun:test).
bun test

# Review-gate poller smoke run (requires authenticated gh and opencode).
cd tooling/review-gate-poller
RG_REPO=<owner/repo> RG_WORKDIR=<repo-working-dir> bun poller.ts

# Unbacked-work monitor manual invocation; set roots and output explicitly.
UNBACKED_WORK_ROOTS=<comma-separated-roots> \
UNBACKED_WORK_TRUSTED_REMOTES=origin \
UNBACKED_WORK_OUTPUT_DIR=<output-dir> \
bun tooling/unbacked-work-monitor/unbacked-work-monitor.ts
```

TODO: confirm the preferred repository-wide test command and whether any future
lint, typecheck, build, or CI commands should be added; no package scripts or CI
workflow were detected.

## Runtime and tooling

- Bun is inferred from `#!/usr/bin/env bun`, `bun:test` imports, and tooling
  READMEs; TODO: confirm the supported Bun version.
- Required CLIs documented by the tooling are `bun`, authenticated `gh`, and
  `opencode`.
- The repository targets macOS launchd for documented background jobs; TODO:
  confirm supported operating systems beyond macOS.
- No package manifest or lockfile was detected, so no package-manager install
  command or pinned dependency set is defined.
- No required env file was detected. Tooling uses explicit environment variables
  documented in its README files.
- Test runner: Bun's built-in test runner is inferred from `bun:test` imports.

## Architecture constraints

- GitHub is the coordination layer and source of truth; chat is not.
- Keep canonical custom skills under `skills/` and plain reusable prompts under
  `prompts/`; adopted upstream skills are consumed rather than edited in place.
- Preserve the separation between planning/review, OpenCode execution, and
  GitHub durable artifacts.
- Review verdicts are comment-only and stale whenever the PR head SHA changes.
- `from-pr-review` must not merge or claim readiness from local output alone.
- Preserve the evidence-bundle contract, check-run gate, and slice-contract rule
  defined in `WORKFLOW.md`.

## Safety constraints

- Do not expose secrets, tokens, cookies, JWTs, passwords, private keys, or
  sensitive payloads.
- Do not commit generated outputs or mutate deployment behavior unless the issue
  requires it.
- Do not perform live writes without explicit authorization.
- Do not mutate production state in tests.
- Tests that touch Docker, named containers, cloud resources, or non-namespaced services are live-infra mutations by default and must be isolated.
- Anything touching write endpoints, auth paths, public surfaces, or live NUC /
  homelab infrastructure is HITL by default.
- A green local command does not replace the current GitHub check-run state.

## Generated artifacts

- `.slim/` is an ignored linked-worktree directory; do not commit it.
- The unbacked-work monitor writes `scan.json` and `attention.md` under its
  configured external output directory, normally outside this repository.
- The review-gate poller stores idempotency state under its configured external
  state directory.
- No repository-local `output/`, `coverage/`, or `dist/` directory was detected.
  TODO: document any generated directories introduced by future tooling.

## Live systems and external services

- **GitHub (`ptstory/tracer-workflow`):** read with `gh` issue/PR/check commands;
  label, issue, comment, PR, and merge operations are mutations requiring the
  workflow's authorization. No dry-run mode was established for all GitHub
  writes. TODO: confirm maintainer approval requirements and any protected-branch
  policy.
- **launchd jobs:** documented poller/monitor installation mutates the local
  user's LaunchAgents and state directories. Prefer smoke-testing manually first;
  unload/remove the job to roll back. No production resource names or safe
  namespace apply.
- No Docker, named container, compose, cloud, or other non-namespaced service
  references were detected.

## Domain glossary

- **Tracer custom skill** — a repo-owned runtime skill under `skills/`.
- **Adopted skill** — an upstream skill consumed by this workflow, not authored
  or edited here.
- **Evidence bundle** — exact local commands and outputs anchored to a PR head
  SHA; prose alone is insufficient.
- **Check-run gate** — merge readiness requires all required checks green for the
  current PR head SHA.
- **Slice contract** — a downstream issue may start only when its blocker
  supplies the exact data/API/behavior/file contract it consumes.
- **HITL / AFK** — human-in-the-loop versus pre-authorized autonomous work.
- **Review-gate verdict** — SHA-stamped, comment-only review state; only a fresh
  verdict for the current head can drive the gate.
- **Unbacked work** — local commits not retained by a trusted remote ref.

## Known foot-guns

- A review verdict becomes stale after any push because the head SHA changes.
- Local test output and PR prose do not establish merge readiness; inspect actual
  GitHub check runs for the current SHA.
- `skills/next/SKILL.md` is misleadingly named and must be interpreted by its
  contents.
- launchd runs with minimal `PATH`; documented jobs use absolute paths and pinned
  environment values.
- `gh` must be authenticated for the review-gate poller and GitHub mutations.
- The repository has no package scripts, lockfiles, or CI workflows to serve as
  automatic authoritative checks.

## Branch and PR expectations

- Default branch is `main` and the remote is `origin` at
  `git@github.com:ptstory/tracer-workflow.git`.
- Use one issue per branch/session and one PR per issue.
- PRs should include the closing issue reference and an evidence bundle anchored
  to the reviewed head SHA.
- Prefer draft PRs unless the workflow or maintainer says otherwise.
- Merge is manual by default; the current check-run gate is authoritative.
- No GitHub Actions workflows or required-check names were detected. TODO:
  confirm branch protection and required reviewers/checks in GitHub.

## Evidence requirements

- Record exact local commands and their output, tied to the exact PR head SHA.
- Use GitHub check-run state as authoritative when CI exists; do not substitute
  narrated confidence or stale reports.
- Screenshots and prose do not replace machine-readable reports when those exist.
- Include issue acceptance criteria, tests/checks run, smoke or dry-run results,
  and generated-artifact accounting in the handoff.

## Review expectations

Done means the issue acceptance criteria are satisfied; relevant tests and
issue-specific smoke/dry-run commands are recorded; generated artifacts are
accounted for; the PR contains the closing issue reference and evidence bundle;
and readiness is checked against actual check-run state for the current head SHA.
TODO: confirm any repository-specific reviewer roster or merge policy beyond
`WORKFLOW.md`.
