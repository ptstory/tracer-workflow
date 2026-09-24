# PR body contract

Source: `mattpocock/skills/skills/in-progress/pr/SKILL.md` at commit `c55ee46073ed923f86ce59a5eb3b6d895095d1b7` (fetched from `raw.githubusercontent.com`). Adapted for Tracer's issue-backed evidence and review gate.

Use this exact section order for the PR body, with no preamble before the closing reference:

```markdown
Closes #<n>

## Summary

<brief change and reason; use a compact diagram, diff sketch, or tree when it clarifies the change>

## Evidence

- Head SHA: <full 40-character PR head SHA>
- Test node IDs run: <exact node IDs, or "none (no tests run)">
- Verification: <link to CI run for this head, or literal command and exit status; include relevant output>
- Before / after: <failing and passing output, screenshots, or "not applicable" with reason>

## Merge Danger

Door: one-way|two-way

Blast Radius: <free-text scope and potential ramifications>
```

Replace `Door: one-way|two-way` with exactly one of `Door: one-way` or `Door: two-way` on its own line. A one-way door is destructive or difficult to reverse; a two-way door is cheap to roll back. Explain relevant rollback constraints and impacts in Blast Radius, without constraining it to a one-word label.

Bind `Closes #<n>` to the governing issue, not a related issue. Summary should make the key change legible in the issue's domain language; select only the visual form that helps, such as pseudocode for logic, a call tree for flow, a component tree for UI, a shallow file tree for responsibilities, or a diff sketch for a small change.

Evidence is a pointer to verification, not proof by assertion. List exact test node IDs actually run (use `none (no tests run)` when applicable) and provide a CI run link tied to the PR head or the literal local command, exit status, and relevant output. For multiple verification steps, list each separately. State the head SHA so local evidence can be checked against the final diff; regenerate the bundle after a rebase or conflict resolution. Prose such as "tests pass" or "coverage added" does not substitute for executable results. Include before/after evidence when applicable, especially for behavior fixes or visual changes, and explain when it is not applicable. Reviewers must open the linked run or verify the command and result against the current head; the PR body itself is never the evidence.
