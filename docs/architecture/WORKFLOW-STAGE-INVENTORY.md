# Workflow stage authority and deployment inventory

This inventory declares the semantic authority and known deployment path for
Tracer's workflow stages. `WORKFLOW.md` defines workflow semantics and the stage
chain; `RUNTIME.md` records current product bindings. This file records the
per-stage source-to-consumer relationship, observed evidence, and unresolved
deployment gaps. It is the input inventory for #81, not a second policy
framework or a runtime parity checker.

## How to read status

- **clean**: the observed local target matches its declared source, or the
  repo-backed mechanism and its observed contents agree. This is not proof of
  unobserved cloud/runtime deployment.
- **drift**: evidence shows the observed target differs from its declared source
  or the required installed target is missing. The row names its remediation
  and existing owner.
- **unverifiable**: the available read-only evidence cannot establish the live
  target, configuration, or whether a declared path actually loaded. This is
  never equivalent to clean.

Hashes below identify observed content, not a release assertion. Git blob IDs
are used when available; SHA-256 identifies files in the local runtime audit.
Runtime paths and installation state are machine-specific observations from the
read-only audit, not portable installation instructions.

## Canonical stage inventory

| Stage / policy | Ownership and canonical authority | Consumer / surface | Load or deployment mechanism | Observed version, path, or hash | Evidence | Status and remediation |
|---|---|---|---|---|---|---|
| Planning and issue creation | **Tracer boundary, not a Tracer-owned skill.** `WORKFLOW.md` defines the planning-plane boundary; issues are filed directly or with optional upstream `to-tickets`. | ChatGPT web created skill `to-issues`; other ChatGPT / Claude web planning sessions; GitHub is the durable issue store. | The created `to-issues` skill is a ChatGPT consumer of upstream planning semantics. Its bootstrap, version, and relationship to upstream `to-tickets` are unknown; direct issue filing remains an alternative. | No local `to-issues` or `to-tickets` installation was found. Issue #15 records the created ChatGPT skill; `WORKFLOW.md` names upstream `to-tickets`. | `WORKFLOW.md` stage chain and owner table; issue #15; local path audit. | **unverifiable** actual web loading and source/version lineage. Preserve upstream ownership; #15 owns ChatGPT web behavior, #81 owns parity checks, and #207 owns continuity preflight. |
| `triage-queue` (created ChatGPT skill `gh-triage-queue`) | Tracer-owned prompt authority: [`prompts/triage-queue.md`](../../prompts/triage-queue.md); the created ChatGPT skill is a consumer, not a second semantic authority. | ChatGPT web skill `gh-triage-queue`; Claude web can use the reusable prompt. | Issue #15 records the created ChatGPT skill. The repo prompt remains the canonical definition; the skill bootstrap, version, and source-loading mechanism are unknown, so no direct-load or parity claim is made. | Prompt source blob `121914b28a7ec6846d05fa95f6e0e603954f4d0a`; no web skill payload or live load is observable. | Prompt describes its reusable-prompt role; `WORKFLOW.md` defines triage as optional and shallow; #15 records the created consumer and owns its orchestration. | **unverifiable** actual skill loading and source parity. Keep the prompt canonical; #15 owns web behavior and #81 owns parity strategy/checks. |
| `agent-brief` (created ChatGPT skill) | Tracer-owned prompt authority: [`prompts/agent-brief.md`](../../prompts/agent-brief.md); the created ChatGPT skill is a consumer, not a second semantic authority. | ChatGPT web skill `agent-brief`; Claude web can use the reusable prompt; the resulting durable brief is a GitHub issue comment consumed by `from-issue`. | Issue #15 records the created ChatGPT skill. The repo prompt remains the canonical definition; the skill bootstrap, version, and source-loading mechanism are unknown, so no direct-load or parity claim is made. | Prompt source blob `66cd626db5448387c0dfb5bff1ca06ee90cc7de7`; no web skill payload or live load is observable. | Prompt defines its reusable-prompt role; `WORKFLOW.md` defines its role; #15 owns web orchestration, durable brief authority, and transitions. | **unverifiable** actual skill loading and source parity. Keep GitHub brief as durable state; #15 owns web behavior and #81 owns parity strategy/checks. |
| `from-issue` | Tracer-owned skill: [`skills/from-issue/SKILL.md`](../../skills/from-issue/SKILL.md), with its referenced PR-body contract. | Crush implementation worker; Claude Code may also expose the shared skill. | Repository-backed source is intended to be linked into `~/.agents/skills`; audited machine's Crush and Claude paths resolve through symlinks to `~/.agents/skills/from-issue`, whose contents are copies rather than symlinks into this repository. | Main source blob `974f96528c2b0fa6b1ccfc74aaaa59cff41fa81e`; observed installed SHA-256 `83ed0e846abf3c519b0c6ea00a818b125fe696c42bdf1754ac3b3ec062da4623`, matching source bytes. Runtime path: `~/.agents/skills/from-issue/SKILL.md`. | Tracer source and installed bytes compared; Crush effective loaded-skill list includes `from-issue` on prior sessions. No evidence that this particular Claude Code session loaded it. | **clean** observed content; Claude loading remains **unverifiable**. Preserve source ownership; #81 owns mechanical path/content checks. |
| PR evidence, checks, readiness and HITL/AFK landing | Tracer-owned workflow contracts: [`WORKFLOW.md`](../../WORKFLOW.md), [`skills/from-issue/references/pr-body-contract.md`](../../skills/from-issue/references/pr-body-contract.md), and [`skills/review-gate/references/verdict-contract.md`](../../skills/review-gate/references/verdict-contract.md). GitHub issue, PR, commit, comments and check runs own durable state. | `from-issue`, Review Gate, GitHub Actions readiness and auto-merge workflows, maintainer. | Read canonical repository policy in local worker; CI workflows evaluate live GitHub PR/check data; landing follows issue-level HITL/AFK authority and configured safeguards. | Workflow sources are at current repo main; local policy files are checked in. Live issue/PR/check state is per artifact and SHA, not an installed policy copy. | `WORKFLOW.md` four rules and HITL/AFK section; `.github/workflows/gate-readiness.yml`, `.github/workflows/review-gate-auto-merge.yml`; issue #278 and open PR #279 address issue-level AFK enforcement, but the PR is not yet merged. | **clean** for repository authority; workflow deployment/change ownership stays with their specific issues/PRs. #18 owns Review Gate publication/read-back; #19 owns cross-skill completion postconditions. |
| `review-gate` | Tracer-owned semantics: [`skills/review-gate/PROMPT.md`](../../skills/review-gate/PROMPT.md) and [`skills/review-gate/references/verdict-contract.md`](../../skills/review-gate/references/verdict-contract.md); `verdict-examples.md` supplies examples, not authority. | Active `@review-gate` ChatGPT plugin, per [`RUNTIME.md`](../../RUNTIME.md); prompt also supports fresh ChatGPT/Claude web sessions with GitHub access. | Prompt/contract are fetched or supplied to a web session; the active plugin package and its live loader are not in this repository. The Custom GPT package is explicitly inactive and is not the active consumer. | Canonical source blobs `b5b5e3323a7651df1ac1866a53d689a10a8515a6` and `b300f4700072480be4f9a8d96149358850693f8c`; deployed plugin version/hash cannot be read. #195 tracks plugin source. | Repo runtime docs declare active plugin; #80 documents known semantic drift from a prior installed ChatGPT skill snapshot; #195 states the plugin source is absent. | **unverifiable** live deployment, with **known drift evidence** for the older ChatGPT skill snapshot. #80 owns policy migration, #195 owns versioned plugin source, #18 owns post-and-read-back completion. #81 owns a later observable deployment/parity marker; do not claim cloud verification. |
| `from-pr-review` | Tracer-owned mechanical fixer: [`skills/from-pr-review/SKILL.md`](../../skills/from-pr-review/SKILL.md); judgment stays in [`references/disposition-rules.md`](../../skills/from-pr-review/references/disposition-rules.md) and the Review Gate verdict contract. | Crush fix worker; Claude Code may expose shared skill. | Intended repo-backed `~/.agents/skills` installation. Audited Crush and Claude paths resolve to a copy in `~/.agents/skills`, not directly to the Tracer checkout. Skill explicitly loads authoritative contracts from the repo or fetches them. | Source blob `e430b6e612b5aa8306806787c8a53f2ce8c25493`; installed SHA-256 `efdeb3f71a0e0d661e9b942b29b8ae1493ae8413886255cbfd193149debafe0e`, matching source bytes. Runtime path `~/.agents/skills/from-pr-review/SKILL.md`. | Source-to-installed content comparison; skill instructions require the canonical verdict contract; Crush has loaded this skill in previous sessions. Claude loading is not observed. | **clean** observed content; Claude loading remains **unverifiable**. #81 owns mechanical path/content parity. Keep disposition ownership separate from execution plumbing. |
| Post-review repair judgment | Tracer-owned rules in [`skills/from-pr-review/references/disposition-rules.md`](../../skills/from-pr-review/references/disposition-rules.md), constrained by the Review Gate verdict contract. | `from-pr-review` worker. | Local reference loaded by the skill; its verdict-contract dependency is read from the repository or fetched by the explicit fallback. | Canonical repo files; installed reference content is part of the from-pr-review copy, but no separate runtime load observation. | `from-pr-review/SKILL.md` requires per-row disposition before fixes and instructs stopping if canonical contract unavailable. | **unverifiable** load at a particular invocation. Keep one semantic authority; #19 owns broad completion-postcondition audit. |
| `next` | Tracer-owned safety stub: [`skills/next/SKILL.md`](../../skills/next/SKILL.md). Issue #30 owns the future functioning selector and its deterministic policy. | No functioning Tracer selector is declared installed. | Current repository file is only a safety stub directing to `whatsnext` / the separately tracked `tracer resume` route; installation is absent in the audited `~/.agents/skills` and Crush paths. | Source blob `7cecaad04eddd0e4850b433ed6b0a94f59fb0026`; no runtime target exists. | Source explicitly says it is a temporary stub; `WORKFLOW.md`/README warn it is not a selector; issue #30 owns the replacement. | **drift** for deployment (missing install), with semantics intentionally incomplete. Do not install it as a working selector or invent policy; #30 owns implementation and installed verification, #81 later represents/checks the state. |
| Adopted upstream planning method: `to-tickets` (created ChatGPT consumer named `to-issues`) | Upstream `to-tickets` owns its semantics; Tracer documents it as optional in `WORKFLOW.md`. The created ChatGPT `to-issues` skill is a separate consumer; do not assume identical source, bootstrap, or version. | ChatGPT web skill `to-issues`; other planning sessions may use upstream `to-tickets` or file issues directly. | Upstream method may be available per runtime; the created ChatGPT skill's bootstrap, version, and relationship to that method are unknown. Direct issue filing bypasses either skill. | No local runtime installation or pinned upstream version was established. `WORKFLOW.md` names `to-tickets`; issue #15 records created ChatGPT `to-issues`. | `WORKFLOW.md`; issue #15; local shared-skill path audit. | **unverifiable** actual web loading, deployed version, and source lineage. Preserve upstream ownership; #15 owns ChatGPT web behavior and #81 owns parity strategy/checks. |
| Adopted upstream review: `requesting-code-review` | Upstream skill source and semantics; Tracer's [`skills/review-gate/PROMPT.md`](../../skills/review-gate/PROMPT.md) explicitly says not to depend on it for Review Gate policy. | Other review integrations where separately invoked. | Upstream-managed installation; not required by the Tracer Review Gate prompt. | No local shared runtime installation or pinned version established. | Tracer prompt explicitly disclaims reliance; local path audit found no installed skill. | **unverifiable** upstream install; no Tracer deployment remediation. Keep upstream owner. |
| Adopted upstream review: `receiving-code-review` | Upstream skill source and semantics; Tracer fixer judgment is defined instead by the from-pr-review disposition reference and Review Gate contract. | Potential upstream reviewer/fixer integration. | Upstream-managed installation; not required to resolve Tracer verdicts or disposition. | No local shared runtime installation or pinned version established. | Repo references it only as an adopted skill; `from-pr-review` delegates judgment to Tracer-owned rules; local path audit found no installed skill. | **unverifiable** upstream install; preserve the boundary and do not fork it for parity. |
| Review Gate poller (parked automation) | Tracer tooling: [`tooling/review-gate-poller/`](../../tooling/review-gate-poller/); current verdict policy is shared repo contract. | OpenCode/local legacy poller; not an active runtime binding. | launchd/local installation mechanism documented but parked; #184 tracks runtime decoupling. | Current `RUNTIME.md` declares parked, not in use; no active installation was verified. | `RUNTIME.md`, poller README, issue #184. | **unverifiable** actual machine installation; operationally **not active by declaration**. Keep parked until #184 resolves; do not count it as an active stage consumer. |
| `continuity-preflight` | Tracer-owned canonical prompt: [`prompts/continuity-preflight.md`](../../prompts/continuity-preflight.md), with deterministic behavioral evaluation fixtures in the adjacent TypeScript files. | ChatGPT/Claude web planning sessions and local agents with GitHub read access; GitHub remains the durable source. | Copyable read-only prompt invocation; no installed skill, automatic enforcement, or vendor deployment is established. | Prompt and replay fixtures are repository-backed; no web consumer load or invocation was observed for this audit. | `WORKFLOW.md` planning entry; canonical prompt; behavioral fixture tests; issue #207 requires no deployment-parity claim without observation. | **unverifiable** live deployment/parity. Preserve the prompt as authority, report coverage/degraded reads, and make no state writes. #207 owns the scoped preflight. |

## Personal policy boundary

The `operator-profile` repository's `OPERATOR.md` is a personal operating-preferences source,
not Tracer workflow policy. It remains separately owned and is not part of the
stage list, Tracer contract, or #81 stage schema. The prior local audit found the
local `operator-profile` checkout behind remote `main`; therefore
the local file read in that audit is a **drift** observation, not a claim about
current remote content. ChatGPT custom-instruction and Claude-memory pointers to
that private repo are declared by the profile's sync process, not verified loads.

| Personal source | Consumer | Observed mechanism and state | Evidence | Status |
|---|---|---|---|---|
| `operator-profile:main/OPERATOR.md` | ChatGPT, Claude, Crush agents | Profile directs ChatGPT custom instructions and Claude memory to read this private source; Crush has no confirmed auto-load pointer. Current installation/retrieval in web/cloud surfaces is not observable here. | Profile sync instructions; local checkout was behind remote main in the prior read-only audit. | **drift** for local checkout; web/cloud retrieval **unverifiable**. Keep remediation in the operator-profile repo and each vendor's custom instruction/memory surface, not in Tracer policy. |

## Runtime observations from the read-only audit

These observations describe one machine/session and do not define Tracer policy or
become a second source of truth:

| Surface | Observation | Evidence and status |
|---|---|---|
| Crush global context | Installed `~/.config/crush/CRUSH.md` matched `crush-config` source, blob `82fd5d5bdc91e621bf747803ec3ed6a81c2a4f72`, SHA-256 `261528449bde953fb1de03cdf5c864a1822c0d94511fc43f0b04e0e5d6373ed8`; a live `crush run` named this file as loaded. | **clean**, verified on 2026-11-19. |
| Crush config (`crushrc`) | Installed `~/.config/crush/crushrc` differed from `crush-config` main blob `3752b1a19f5945cbf97b7118736a85df6700f317`. Installed had Luna/max and denied only `agent`, `agent_dispatch`; repo main selected Sol/high and denied all five subagent controls. Repo main issue #17/PR #19 is the security baseline. | **drift**, verified on 2026-11-19. Remediation belongs in the crush-config installation workflow; do not change it from this Tracer issue. |
| Local operator profile | `~/Code/operator-profile` local `main` did not match remote `main` during the audit. | **drift**, personal-policy boundary only; sync in operator-profile, not here. |
| Crush data-directory JSON | `~/.local/share/crush/crush.json` had no context/prompt/instruction keys; effective default global path was independently observed from a real Crush run. | **clean** for observed default path; no claim about other configuration sources. |
| Claude Code shared skills | `~/.claude/skills/{from-issue,from-pr-review}` symlink through `~/.agents/skills`; those installed skill contents matched Tracer main source bytes. This confirms path/content, not that a Claude Code or Claude web session loaded them. | **clean** bytes/path; live invocation **unverifiable**. |
| ChatGPT and Claude web policy | Current custom instructions, plugin payload, chat memories, and server-side skill configuration are not exposed by the local filesystem or GitHub API used in the audit. | **unverifiable**. Do not convert documentation or a previous captured skill snapshot into a claim of live retrieval. |

## Verification and ownership rules

1. `WORKFLOW.md` owns the stage chain and substantive Tracer workflow rules;
   `RUNTIME.md` records replaceable product bindings; this inventory records the
   declared source/consumer/deployment relationship and evidence class.
2. A row marked **clean** applies only to the observed path/content and date. It
   does not establish that a cloud session loaded the same bytes.
3. A row marked **drift** names its remediation owner. Absence of an installed
   stage is not repaired by changing a different stage or copying its semantics.
4. A row marked **unverifiable** requires an explicit runtime read-back or a
   truthful manual deployment record if its product surface cannot be queried;
   unverifiable must never be reported as clean.
5. Repo-backed symlinks should resolve to the single canonical source where the
   runtime supports it. Copied/generated deployment artifacts require a
   deterministic source version/hash marker and an observable deployment
   read-back. #81 owns the mechanical checker and its output schema; this
   inventory does not implement that checker or claim inaccessible-surface
   verification.
6. Future Tracer-owned stages must declare canonical source, consumers, and the
   deployment/load mechanism here or an explicitly linked successor before they
   are described as installed. Adopted upstream stages must name their upstream
   owner and must not be silently copied into Tracer authority.
7. Keep existing issue boundaries: #15 owns triage/brief web orchestration; #18
   owns Review Gate publication/read-back; #19 owns completion-postcondition
   audit; #30 owns the functioning `next` selector; #80 owns Review Gate policy
   migration; #81 consumes this inventory for drift checks; #184 owns poller
   runtime decoupling; #195 owns versioned ChatGPT plugin source; #206 owns
   downstream adoption/PR-body drift; #207 owns pre-planning continuity.
