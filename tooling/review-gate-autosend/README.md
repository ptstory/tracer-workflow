# Review Gate Auto-send

This package launches ChatGPT with a prefilled Review Gate prompt after `from-issue` or `from-pr-review` finishes, unless the PR already has a trusted verdict for its current head.

## Install the userscript

Install Tampermonkey in the browser profile used for ChatGPT. Choose **Create a new script**, replace the editor contents with `review-gate-autosend.user.js` from this directory, and save it.
Keep `ALLOWED_OWNERS` restricted to repository owners you trust. The provided v1.3 source allows only `ptstory`. Verify the opt-in manually with a test PR URL before relying on it.

The userscript runs at `document-start` because ChatGPT removes the `q` parameter after reading it. It sends only a matching `@review-gate https://github.com/<owner>/<repo>/pull/<n>` prompt with `autosend=1`, and it targets `form button[aria-label="Send"]` first. It waits for the composer to remain stable for 1.5 seconds, sends at most once per prompt per tab, and leaves the prompt for manual sending after 30 seconds.

## Run after an issue or fix pass

`from-issue` and `from-pr-review` run this helper with the full PR URL after pushing their final commit:

```sh
TRACER_REVIEWER_LOGINS=<comma-separated-logins> bun tooling/review-gate-autosend/review-gate-autosend.ts https://github.com/<owner>/<repo>/pull/<n>
```

The helper prints the PR URL as a fallback. It reads the current PR head and comments through `gh`, then uses the canonical #212 verdict parser with the configured trusted reviewer allowlist. A conforming verdict for the current head suppresses the launch and prints the verdict and its next action. A stale or missing verdict launches:

`https://chatgpt.com/?autosend=1&q=<URL-encoded "@review-gate <full PR URL>">`

If GitHub data or trusted reviewer configuration cannot be read, the helper fails closed and does not launch Review Gate.
