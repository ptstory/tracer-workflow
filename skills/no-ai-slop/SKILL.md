---
name: no-ai-slop
description: >
  Edit drafts into sharper, more human writing while preserving the writer's
  voice. Use the Humanizer reference only as a supplemental findings checklist,
  never as an autonomous rewrite or reorder pass.
---

# No AI slop

Adopted from `petergyang/no-ai-slop@000650b156983f5159695b441477f4e63b25dc85`.
This repo copy keeps the upstream goal: preserve the writer's point and voice
while removing AI patterns only when they actually hurt the piece.

## Two jobs

**Edit (default).** The user shares a draft to fix. Make the minimum effective
edit. Return the edited draft and a brief `What changed` section.

**Audit.** The user asks whether text reads like AI slop. Name each matching
pattern, quote the line, and give a short fix. Do not rewrite, score, or guess
authorship. Humanizer is findings-only supplemental audit, not a second editor.

## What not to ban

These are not bans: em dashes, emojis, title case, bold-label lists, passive
voice, groups of three, repeated sentence openings, and rhetorical fragments.
Keep them when they fit the writer's voice or the piece.

## How to edit

- Preserve the writer's real voice.
- Make the minimum effective edit.
- Keep the point.
- Use active voice when it clarifies who acts.
- Cut filler, puffery, and repetition.
- Keep structure unless structure is the problem.
- Do not invent facts, examples, or claims.
- If a detail is missing, ask.

## Supplemental Humanizer audit

Use `reference/humanizer-patterns.md` after the first read as a checklist for
extra AI tells.

- Treat it as evidence, not as a rewrite script.
- Do not autonomously reorder, expand, or rewrite a draft just because a
  pattern matches.
- If a matched pattern is clearly intentional, keep it.
- If the sample uses one of the listed non-bans well, leave it alone.
- Do not create a separate Humanizer pass or delivery stage.

## Patterns to cut

- Binary contrasts like "It's not X. It's Y."
- Throat-clearing openers like "Here's the thing."
- Faux-insight setups like "What nobody tells you is..."
- Weasel attribution like "experts say" without a source.
- Importance puffery like "marks a pivotal moment."
- Superficial analysis that hangs on `-ing` phrases.
- Fake-profound kickers, summary endings, and dramatic fragments that add
  nothing.
- Formatting slop that decorates instead of clarifying.

## Words to cut

- delive, foster, leverage, utilize, facilitate, empower, streamline, robust,
  cutting-edge, paradigm shift, game changer, tapestry, realm, beacon,
  multifaceted, meticulous, intricate, paramount, transformative, elevate,
  embark, supercharge, harness, ever-evolving.
- Cut filler like just, literally, honestly, simply, actually, truly,
  fundamentally, importantly, crucially, inherently, inevitably when they add
  nothing.
- Cut throat-clearing like it's worth noting, at the end of the day, when it
  comes to, at its core, in today's world, in the world of, the reality is, the
  truth is, going forward, let's dive in.

## How to return the result

- **Pasted text.** Return the edited draft and a short `What changed` section.
- **File mode.** Write only the final prose to the file. Keep code blocks, YAML
  metadata, data, and link targets unchanged.
- **Audit mode.** Return pattern findings only. Do not rewrite the draft.
