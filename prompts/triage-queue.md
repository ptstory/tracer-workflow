# triage-queue prompt

Paste into a **fresh** ChatGPT/Claude web session with GitHub connector access.
Replace `<REPO_URL_OR_OWNER_REPO>`.

This is a plain reusable prompt, not an auto-triggered skill or slash command.
It is intentionally shallow: it recommends a triage queue for many issues, but
it does not perform deep single-issue triage or write full agent briefs unless
explicitly asked.

Session and continuation behavior follows [`CONTINUATION.md`](../CONTINUATION.md).
Repository-wide triage starts fresh from planning context. If this pass yields
one unique high-confidence next item, its first `agent-brief` may continue in
this same triage conversation; a different item later normally starts fresh.

---

Evaluate the open issue queue for `<REPO_URL_OR_OWNER_REPO>`.

Use GitHub as the source of truth. Read open issues and, if the repo treats
external PRs as a request surface, include external PRs as PR-shaped issues.

Produce a repository-wide triage queue, not final issue decisions.

For each relevant item, recommend:

- item number and title
- item type: `issue` or `PR`
- category: `bug`, `enhancement`, or `unclear`
- recommended state: `needs-triage`, `needs-info`, `ready-for-agent`,
  `ready-for-human`, or `wontfix-candidate`
- confidence: `high`, `medium`, or `low`
- one-line rationale
- next action: `deep-triage`, `agent-brief`, `human-decision`, `needs-info`, or
  `no-action`

Buckets to show, oldest first within each bucket:

1. Unlabeled / never triaged
2. `needs-triage`
3. `needs-info` with reporter activity since the last triage notes
4. Clear `ready-for-agent` candidates
5. Human-decision candidates
6. Wontfix candidates

Rules:

- Do not post comments.
- Do not change labels.
- Do not close issues.
- Do not write agent briefs during queue triage unless explicitly asked for one
  item.
- Do not claim a bug is verified unless you actually verified it.
- Do not rely on planning-chat history.
- Flag state-label conflicts instead of resolving them silently.
- Treat the output as a recommendation list for the maintainer to pick from.
- Low confidence recommendations are not action-ready; set next action to
  `deep-triage` or `human-decision`.
- `wontfix-candidate` is only a queue recommendation. `wontfix` is a deep-triage
  decision made by `agent-brief` or the maintainer.
- Do not create a `tracer-continuation` pointer from queue analysis alone. The
  selected issue becomes pointer-worthy when `agent-brief` writes a durable
  issue/PR artifact.

Output format:

```markdown
# Triage Queue: <owner/repo>

## Summary

- Open issues reviewed: <n>
- External PRs reviewed: <n>
- Clear ready-for-agent candidates: <n>
- Needs-info candidates: <n>
- Human-decision candidates: <n>
- Wontfix candidates: <n>

## Queue

| Item | Type | Category | Recommended state | Confidence | Rationale | Next action |
|---|---|---|---|---|---|---|
| #123 Title | issue | bug | ready-for-agent | high | One-line reason | agent-brief |

## State conflicts

- #<n> — describe conflicting labels or ambiguous state, if any

## Recommended next pick

Start with #<n> because <reason>.

**Session policy:** continue in this triage conversation for the first uniquely
selected `agent-brief`.

**Next action:** `agent-brief <exact issue-or-PR URL>`
```

If there is no unique high-confidence next pick, say so and end with exactly one
human selection/inspection action instead of inventing a target.
