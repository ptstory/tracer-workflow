# Tracer Review Gate Watcher

The Herdr watcher reports trusted, current-head Review Gate verdicts to the active Herdr session. It only displays notifications; it never starts a pane or agent, selects issues, runs Review Gate, or merges.

## Install

Link this repository's plugin manifest into Herdr:

```sh
herdr plugin link /path/to/tracer-workflow/tooling/herdr-watcher --enabled
```

The plugin runs as a Herdr startup hook. Its foreground listener subscribes to workspace/worktree lifecycle events and reconciles configured GitHub repositories against a live Herdr snapshot. It exits when the plugin is disabled or Herdr shuts down; reconnects and periodic refreshes reconcile missed events. No detached daemon or launchd job is used. Disable stops future hooks; an invocation already running will finish or exit when its Herdr session becomes unavailable.

## Configure

Create the plugin config file at the path printed by `herdr plugin config-dir tracer.review-gate-watcher`, then copy `config.example.toml` to `config.toml` there and set the watched repositories and trusted Review Gate reviewer logins. Set `TRACER_REVIEWER_LOGINS` in Herdr's process environment to the same comma-separated trusted reviewer list; the listener fails closed if it is absent:

```toml
repositories = ["owner/repo"]
reviewer_logins = ["review-bot"]
refresh_interval_seconds = 60
```

Use authenticated `gh` with read access to each configured repository. Each open pull request must close exactly one open governing issue. Pull requests without a unique open issue, with HITL/needs-human/needs-fix/ready-for-human markers, or with unclear issue autonomy are ignored. Issues labeled `blocked`, `needs-info`, or `needs-triage` are also ignored. Add explicit `Autonomy: AFK-safe` to a governing issue body to make its notifications eligible; titles marked `[HITL]` or `[needs-human]` and explicit human-autonomy values remain excluded. The `ready-for-agent` label alone does not authorize an actionable notification.

The trusted allowlist, verdict parser, current-head freshness, label agreement, and circuit-breaker decisions come from `tooling/lib/verdict.ts` and `tooling/lib/review-gate-eligibility.ts`. GitHub identity, head, labels, issue state, comments, and Herdr plugin availability are re-read before a notification is shown. Missing configuration, failed API reads, stale/malformed/untrusted verdicts, label disagreement, HITL markers, and exhausted corrective rounds fail closed.

## Notifications

- `gate:needs-fix`: PR URL plus the manual `from-pr-review <PR_URL>` suggestion. This is not a dispatch; start that flow manually in a separate authorized session.
- `gate:needs-human`: PR URL plus the exact current verdict `next-action`.
- All other verdicts, duplicate notifications for the same PR/head/verdict, and ineligible or unclear state produce no actionable notification.

Notification keys are stored under Herdr's plugin state directory with private file permissions. Reconciliation retains keys for open PRs so reconnects, missed events, and a verdict temporarily changing away and back do not repeat the same notification. A changed head or verdict gets a distinct notification.

## Local checks

```sh
bun test tooling/herdr-watcher/watcher.test.ts tooling/lib/review-gate-eligibility.test.ts --reporter=dot
bun run typecheck
```

Run `bun run tooling/herdr-watcher/watcher.ts --check` with Herdr's plugin config environment to validate config without connecting to Herdr or GitHub. `--once` performs one live reconciliation and requires a running Herdr session.

## Manual Herdr verification

1. On a disposable authorized test repository, link and enable the plugin, configure the repository and reviewer, then check a trusted current-head needs-fix verdict. Verify one Herdr notification contains the PR URL and manual command; verify no pane or agent was created.
2. Reconnect Herdr or replay the repository lifecycle by reopening a worktree workspace. Verify the same PR/head/verdict does not notify again.
3. Change the test verdict to a trusted current-head needs-human verdict. Verify the notification includes the PR URL and the exact next-action.
4. Disable the plugin while its startup listener is active and verify it produces no later notification. An already-running hook may finish; disabling does not guarantee process termination.
5. Repeat with Herdr shutdown. Verify no further notification after session shutdown; Herdr shutdown does not guarantee an in-flight command finishes.
