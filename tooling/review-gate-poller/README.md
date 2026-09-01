# review-gate-poller

Polls open PRs for the latest conforming `review-gate` verdict comment. A
conforming gate comment has `head-sha`, `review-round`, and `reviewed-files`, and
its `head-sha` matches the PR's current head. On a fresh `needs-fix`, the poller
shells `opencode run` to apply the fix pass through `from-pr-review`. Pushing a
new commit invalidates that verdict, so the cycle repeats until
`merge-candidate`.

Only `needs-fix` triggers autonomous action. Humans handle `merge-candidate`,
`needs-human`, and `blocked`, and merge stays manual. Malformed gate-marked
comments are logged and never trigger a fix pass.

## Setup

Requires `bun`, authenticated `gh`, and `opencode` on PATH.

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
| `RG_WORKDIR` | yes | repo working directory where the fix pass runs |
| `RG_STATE_PATH` | no | idempotency state; defaults under `~/.local/state` |
| `RG_REVIEWER_LOGIN` | no | restrict accepted verdicts to one comment author |

## Notes

The poller runs only while the machine is awake. If it misses a verdict, read the
latest gate comment and start the session manually. The verdict remains on
GitHub either way.

The poller exits 0 when a run completes. A non-zero exit means a setup or runtime
error.
