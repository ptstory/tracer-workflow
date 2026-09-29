# skill-discovery prompt

Paste into a terminal coding agent (Crush, OpenCode, Claude Code) started in the
target repository. Replace `<OWNER/REPO>`, `<SINCE>` and `<TRACER_PATH>`.

This is a plain reusable prompt, not an auto-triggered skill. It finds where
agents repeatedly need correction in one repository and recommends what to do
about each pattern. It does not write SKILL.md files.

Extraction is done by `scripts/mine-friction.ts`, not by the model. The model
only reads the digest, clusters, and classifies.

---

Find recurring agent friction in `<OWNER/REPO>` and recommend where each pattern
belongs. Work from evidence only.

## 1. Extract

Run exactly this from the repository root, then read the whole digest it prints:

```sh
bun <TRACER_PATH>/scripts/mine-friction.ts --repo <OWNER/REPO> --since <SINCE> --local-path "$PWD"
```

Do not collect GitHub or transcript data by hand. If a source line in the
digest says `FAILED`, report it under Data gaps and continue with the rest. If
`opencode.db` fails with a schema message, report the schema; do not guess a
query.

Also read, without editing: `AGENTS.md` / `CLAUDE.md` if present, the list of
CI workflow files, and any existing skill directories. You need these to know
what is already enforced or documented.

## 2. List corrections

A correction is one thing an agent or author got wrong that a person, review
bot, or CI then had to catch. Ignore approvals, status notices, merge chatter,
and a user message that is new work rather than a correction. In transcript
entries, the `agent:` line is what the agent did and the `user:` line is the
reaction; long pasted text is usually new work, not a correction.

## 3. Cluster by failure mode

Group corrections by what the agent did wrong, not by file, component, or
technology. Test: could the same mistake happen in a different part of the
repo? If yes, the cluster is named after the behavior (for example "tests check
that text exists instead of exercising behavior"), not the place ("doctor
issues").

Count distinct PRs, issues, and sessions. The same finding repeated across
review rounds of one PR counts once. A cluster needs at least 2 distinct
sources, or 1 if the cost was high; mark those `single, high cost`.

For each cluster, check whether it is already handled: a later CI check,
script, or rule that targets it, and whether it recurred after that date.

## 4. Classify in this order

Take the first bucket that fits:

1. `automate` — a script, CI check, hook, or test fixture can detect it.
2. `guidance` — a one-line rule that should apply to nearly every task in
   this repo (AGENTS.md or equivalent).
3. `revise-skill` — an existing skill or prompt covers the situation but
   misses this.
4. `new-skill` — a procedure needed only in a recognizable situation.
5. `workflow` — needs its own long lifecycle, credentials, or monitoring.
6. `human-decision` — blocked on a policy choice only the owner can make.
7. `drop` — one-off, already fixed with no recurrence, or not worth the cost.

A `new-skill` needs both of these, or it is not one:

- a trigger sentence: "Use when ..."
- a verification step the agent can run to prove it followed the procedure

Then answer yes or no: recurs, has a clear start and end, needs
repo-specific knowledge, costly when wrong.

## 5. Verify before reporting

Re-open the cited items for the three largest clusters and confirm they say
what you claim. Fix or remove anything that does not hold.

## Output

One table, largest cluster first:

| # | Failure mode | Evidence (PR/issue/session IDs) | Distinct sources | Still recurring? | Bucket | Next action |

Rules for the table:

- Every row cites IDs from the digest. No IDs, no row.
- Do not estimate counts. Count what you cite.
- Mark anything inferred rather than read as `(inferred)`.

After the table:

- For each `new-skill` row: the trigger sentence, the verification step, and
  the four yes/no answers.
- Not included: patterns you considered and rejected, one line each.
- Data gaps: failed sources, and what the digest cannot show.
- The three actions you would take first.

Do not draft SKILL.md files, open issues, or edit the repository.
