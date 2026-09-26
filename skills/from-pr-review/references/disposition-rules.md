# Review finding dispositions

For each review-thread ledger row, preserve the reviewer's ask in their own words and restate what change they are requesting. Verify the finding against the actual code and the PR's binding issue before deciding whether it is correct for this codebase. Use the canonical disposition vocabulary and round-aware rules in the verdict contract referenced by `../SKILL.md`.

Assign exactly one disposition to each row, with one line of reasoning grounded in the code and binding issue:

- `fix-now`: a verified blocking issue within the binding scope that must be addressed in this pass.
- `follow-up-issue`: a valid finding that belongs in a separate tracked issue under the contract's scope or stale-finding rules.
- `defer`: a valid non-blocking finding left open with a reason.
- `reject`: a finding contradicted by the code or binding issue; reply with the evidence.
- `needs-human`: a finding whose meaning, correctness, or scope cannot be established without a human decision. Do not guess.

Record the disposition before any fix work. In thread replies, state the evidence and action or reason plainly; do not thank the reviewer or agree performatively.
