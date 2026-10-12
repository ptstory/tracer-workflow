# Review Gate contract snapshot — 2026-10-01

This is a migration snapshot only. The live files in `ptstory/tracer-workflow` are authoritative at execution time.

Source files at plugin creation:

- `skills/review-gate/PROMPT.md` blob SHA `6c4a1f2d60b61713f90000b9fb303d9f9848ce15`
- `skills/review-gate/references/verdict-contract.md` blob SHA `89deabb4babf62389d14788d6f9e31fa80a42370`
- `skills/from-issue/references/pr-body-contract.md` blob SHA `1a2679b67781ad7448aa264c973e0dbfac35a45d`

Important current semantics captured by that snapshot include:

- canonical states: `merge-candidate | needs-fix | needs-human | blocked`;
- mandatory `head-sha`, `review-round`, `reviewed-files`, `blocking-set`, and `next-action` fields;
- conditional `rebaseline: yes`;
- trusted verdict provenance via configured reviewer allowlist;
- append-only verdict history and exact-head staleness;
- full baseline review versus bounded later rounds;
- stale-finding and acceptance-criterion carve-outs;
- corrective-round circuit breaker;
- current-head required-check / changed-path readiness evidence;
- draft PRs block `merge-candidate`;
- branch/rules lookup failure blocks rather than implying no required checks;
- PR-body contract including `Closes #N`, visual Summary, exact-head Evidence pointer, Merge Danger, and justified Docs;
- merge remains human-in-the-loop.
