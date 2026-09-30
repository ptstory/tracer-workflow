---
name: next
description: >
  Temporary safety stub for Tracer's next-work selector. The previous file
  contained an unrelated Deliverable Package Finalizer. Until issue #30 lands,
  use the existing whatsnext command for local backlog selection and issue #35
  for the durable tracer resume router.
---

# Next

This skill is intentionally a **temporary safety stub**.

The previous `skills/next/SKILL.md` content was an unrelated Deliverable Package
Finalizer, so invoking `next` could route an agent into the wrong workflow.

## Current action

1. For local next-work selection, use `whatsnext`.
   - Current source: `~/.config/zsh/functions.zsh`.
2. For generalized durable workflow routing, follow issue #35: `tracer resume`.
3. Do not implement a second selector here.
4. Issue #30 owns the full canonical `next` repair, including deterministic
   priority/frontier selection and installed-skill verification.

## Stop condition

If this skill is invoked before #30 is complete, return the appropriate command
or issue reference above. Do not perform deliverable packaging or invent a
replacement selection policy.
