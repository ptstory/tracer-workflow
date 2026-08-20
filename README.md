# tracer-workflow

An issue-backed, PR-mediated AI coding workflow. GitHub holds the state —
issues, PRs, comments, check runs. Not the chat transcript.

The failure it's built around: the record drifts from reality. Work exists only
on a laptop and nowhere trusted. A session claims tests pass and the checks say
otherwise. A review approves code, someone pushes, and the approval silently now
refers to a commit that no longer exists.

Each stage closes one of those gaps. Intent becomes an issue. Work becomes a PR
with an evidence bundle. Review runs in a fresh session carrying none of the
planning thread's assumptions, and its verdict is stamped with the head SHA —
push, and the verdict is invalid by construction. Check-run state, not narrated
confidence, decides readiness. A nightly monitor finds commits no remote is
holding.

Sessions are treated as good workers with bad memories: trusted to do the work,
never trusted as the record of it.

Personal workflow, not a product. Deliberately heavier than a small change
warrants — it earns its cost when work spans sessions, needs review, or would be
expensive to misremember.

Vocabulary is defined once in [CONTEXT.md](./CONTEXT.md). Doctrine — the HITL/AFK
rule, the evidence-bundle contract, the slice contract, and the check-run gate —
lives in [WORKFLOW.md](./WORKFLOW.md), along with the full stage table.

## One issue, end to end

A raw idea goes through `to-issues` and comes out as scoped issues, one vertical
slice each. `triage-queue` does a shallow pass over everything open and
recommends what to look at; `agent-brief` then reads one issue deeply and
produces the durable triage comment that makes the issue safe to hand to an
agent. `next` reports which of those issues have no open blockers.

`from-issue` takes one of them, cuts a branch, implements the slice, and opens a
PR carrying `Closes #N` and an evidence bundle — exact commands and their output,
anchored to the head SHA, rather than a prose claim that things work.

`review-gate` is pasted into a fresh web session with a GitHub connector. It runs
`requesting-code-review`, classifies findings through `receiving-code-review`
dispositions, and posts a verdict comment stamped with the head SHA it reviewed.
The fresh session is the point: it reviews against the issue as written and
carries none of the planning thread's assumptions.

On a needs-fix verdict, `from-pr-review` applies the fixes, replies per thread,
and pushes. The push moves the head SHA, which invalidates the verdict by
construction, and the circuit runs again. Only needs-fix triggers autonomous
action; every other verdict surfaces to a human. Merge is manual, and requires
all required checks green at the current head.

```mermaid
flowchart LR
    idea([raw idea / PRD]) --> ti[to-issues]
    ti --> tq[triage-queue]
    tq --> ab[agent-brief]
    ab -->|ready-for-agent| nx[next]
    nx --> fi[from-issue]
    fi -->|"PR + Closes #N"| rg[review-gate]
    rg -->|verdict on PR| fpr[from-pr-review]
    fpr -->|delegates judgment| rec[receiving-code-review]
    rec -->|disposition| fpr
    fpr -->|check-run gate| gate{all checks green?}
    gate -->|yes| merge([merge])
    gate -->|no| rg
    merge --> nx

    classDef custom fill:#2d3748,stroke:#4fd1c5,color:#fff
    classDef adopted fill:#2d3748,stroke:#718096,color:#fff
    class fi,fpr,nx,rg,tq,ab custom
    class ti,rec adopted
```

Teal = custom, owned here. Gray = adopted, consumed not authored.

## Where things live

Custom skills are versioned under `skills/`; this repo is their canonical source.
The canonical definitions for the ChatGPT-web stages live under `prompts/`, and
the installed ChatGPT skills are kept aligned with them by hand — tightening that
parity, and the posting and supersession contracts around it, is tracked in #15.

Adopted skills are upstream copies, extended through their config seams or routed
around, never edited in place. `receiving-code-review` has no config seam and is
used stock; `requesting-code-review` takes review scope via a root
`context-snapshot.json` when present.

The full stage table — every skill, its owner, and its role — is in
[WORKFLOW.md](./WORKFLOW.md).

## Tooling

**`tooling/review-gate-poller/`** — Bun poller that watches open PRs for a fresh
needs-fix verdict at current head and shells `opencode run` to start the fix
pass. Only needs-fix triggers it; every other verdict is left for a human. See
its [README](./tooling/review-gate-poller/README.md) for environment variables
and launchd install.

**`tooling/unbacked-work-monitor/`** — nightly Bun monitor for local-only commits
retained by branches or linked worktrees but not by trusted remote refs. It scans
configurable repository roots recursively, discovers non-bare Git repos, and
writes JSON + Markdown reports. See
[`tooling/unbacked-work-monitor/README.md`](./tooling/unbacked-work-monitor/README.md)
for roots-based invocation, output paths, and launchd install notes.

Verdict format and the two load-bearing rules (SHA-staleness, comment-only):
[skills/review-gate/references/verdict-contract.md](./skills/review-gate/references/verdict-contract.md).
