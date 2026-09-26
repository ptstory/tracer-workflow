# PR body contract

Source: `mattpocock/skills/skills/in-progress/pr/SKILL.md` at commit `c55ee46073ed923f86ce59a5eb3b6d895095d1b7` (fetched from `raw.githubusercontent.com`). Adapted for Tracer's issue-backed evidence and review gate.

Use this exact section order for the PR body, with no preamble before the closing reference:

```markdown
Closes #<n>

## Summary

<visual summary: pseudocode block, call tree, component tree, shallow file tree, Mermaid diagram, or diff sketch; optionally one sentence of text; prose alone does not satisfy Summary>

## Evidence

- Head SHA: <full 40-character PR head SHA>
- Test node IDs exercising changed paths: <only relevant node IDs; if none, one line stating no test exercises the change, not a suite listing>
- Verification: <link to CI run for this head, or literal command and exit status; include relevant output>
- Before / after: <failing and passing output, screenshots, or "not applicable" with reason>

## Merge Danger

Door: one-way|two-way

Blast Radius: <free-text scope and potential ramifications>

## Docs

<list the docs updated, or one line explaining why no docs were needed>
```

Replace `Door: one-way|two-way` with exactly one of `Door: one-way` or `Door: two-way` on its own line. A one-way door is destructive or difficult to reverse; a two-way door is cheap to roll back. Explain relevant rollback constraints and impacts in Blast Radius, without constraining it to a one-word label.

Bind `Closes #<n>` to the governing issue, not a related issue. Summary must be a visual: a pseudocode block, call tree, component tree, shallow file tree, Mermaid diagram, or diff sketch, optionally with one sentence of text. Prose alone does not satisfy Summary. In Docs, list the documentation updated or give one line explaining why none was needed; a bare "none" is not a justification.

Evidence is a pointer to verification, not proof by assertion. List only the test node IDs that exercise the changed paths, plus the CI run link for the current head. If no test exercises the change (docs-only, config-only), state that in one line instead of listing the suite. A full-suite count ("124 pass, 0 fail") may appear as one line, never as an enumerated list. For multiple verification steps, list each separately. State the head SHA so local evidence can be checked against the final diff; regenerate the bundle after a rebase or conflict resolution. Prose such as "tests pass" or "coverage added" does not substitute for executable results. Include before/after evidence when applicable, especially for behavior fixes or visual changes, and explain when it is not applicable. Reviewers must open the linked run or verify the command and result against the current head; the PR body itself is never the evidence.
