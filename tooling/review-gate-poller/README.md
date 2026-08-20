# review-gate-poller

Polls open PRs for the latest conforming `review-gate` verdict comment — a gate
comment with `head-sha`, `review-round`, and `reviewed-files` — whose
`head-sha` matches the PR's current head. On a fresh `needs-fix`, it shells
`opencode run` to apply the fix pass via `from-pr-review`. Pushing moves the
head SHA, which invalidates the verdict by construction, and the cycle repeats
until `merge-candidate`.

Only `needs-fix` triggers autonomous action. `merge-candidate`, `needs-human`,
and `blocked` are left for a human — merge stays manual. Malformed gate-marked
comments are logged and never trigger a fix pass.

## Setup

Requires `bun`, `gh` (authenticated), `opencode` on PATH.

```
# smoke-test by hand first
cd tooling/review-gate-poller
RG_REPO=<owner/repo> RG_WORKDIR=<repo working dir> bun poller.ts

# then install the launchd job (edit paths + env in the plist first)
mkdir -p ~/.local/state/review-gate
cp com.tracer.review-gate-poller.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.tracer.review-gate-poller.plist
```

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `RG_REPO` | yes | `owner/repo` to poll |
| `RG_WORKDIR` | yes | repo working dir the fix pass runs in |
| `RG_STATE_PATH` | no | idempotency state; defaults under `~/.local/state` |
| `RG_REVIEWER_LOGIN` | no | restrict accepted verdicts to one comment author |

## Notes

Hands-off is bounded by the machine being awake. Asleep = no poll; the fallback
is reading the latest gate comment and kicking the session yourself. The verdict
is on GitHub either way.

The poller exits 0 when a run completes; non-zero means a real setup or runtime
error.
