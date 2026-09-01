## The fence

The orchestrator seat was originally fenced because it kept doing implementation work instead of delegating. Edit and bash were set to deny, along with chisel and serena. Removing the orchestrator's direct ability to act left spawning an executor or fixer as the path for implementation and kept the seat focused on orchestration.

By the numbers, the fence worked. Orchestrator bash share fell from 60.6 percent to 0 percent, executor share rose from 10.6 percent to 89.6 percent, and 97 orchestrator-to-executor child sessions were observed.

## Why the fence came off

The fence fixed the delegation problem but created a double-payment pattern. The orchestrator would diagnose a problem, be unable to act on it, then spend another cycle re-planning the same work for a child session. The clearest example was core-tweaks issue 10, where a single-file mobile CSS fix stretched to 2 hours and 16 minutes. The restriction was costing more than it saved, so edit and bash were flipped back to allow on 2026-08-12.

## The two record errors that kept forcing re-derivation

This history had to be reconstructed more than once because two errors kept propagating through the record.

The first was that unfencing remained incomplete for more than two weeks. The orchestrator `mcps` array is an allowlist, so removing the `!serena` and `!chisel` negations did not grant those tools. From 2026-08-12 through 2026-08-30, the seat had full edit and bash permissions but no symbol tools. It kept re-reading files to answer questions a symbol index could have answered directly. Serena was added to the array on 2026-08-30.

The second was a model-identification mistake that hardened into folklore. A 2026-08-21 audit concluded that the pre-2026-08-18 orchestrator model was `gpt-5.5-fast`, and later sessions repeated it as settled fact. A raw query of `session.model` against `opencode.db` on 2026-09-01 contradicts that claim. `gpt-5.4-mini` ran the seat through 2026-08-12. Both `gpt-5.4-mini` and `gpt-5.4` appear on 2026-08-14. `gpt-5.6-luna-fast` appears from 2026-08-16 through 2026-08-18. `gpt-5.4` runs from 2026-08-18 onward, while `gpt-5.4-mini` reappears on 2026-08-28, 2026-08-29, and 2026-08-31.

Quick-switching means the seat model changes within the date range. Telemetry grouped only by date is therefore contaminated; model needs to be the grouping key.

## What is measured and what is not

From 2026-08-13 onward, the usable orchestrator-seat telemetry groups more cleanly by model than by date.

On `gpt-5.4`, there are 80 sessions, with 179,548 input tokens and 2,648,590 total read tokens per session, 1.96 children spawned per session, and 59 percent of sessions spawning at least one child. On `gpt-5.4-mini`, there are 14 sessions, with 107,651 input tokens and 1,397,159 total read tokens per session, 1.36 children per session, and 43 percent spawning a child. On `gpt-5.6-luna-fast`, there are 9 sessions, with 446,412 input tokens and 1,843,276 total read tokens per session, 3.44 children per session, and 56 percent spawning a child.

End-to-end read tokens per orchestrator session, including direct child sessions, were measured on 2026-09-01 over sessions from 2026-08-13 onward. The averages are 4,542,341 for `gpt-5.4` across 80 sessions, 2,730,314 for `gpt-5.4-mini` across 14 sessions, and 4,021,862 for `gpt-5.6-luna-fast` across 9 sessions. For `gpt-5.4`, direct child sessions consumed 149,689,923 of 363,387,356 total tokens.

Counting children changes the Luna-fast result. Its end-to-end read-token cost is 89 percent of `gpt-5.4`, which is within noise at nine sessions. It delegates 3.44 children per session, so child consumption erases much of the parent's lower usage. Mini remains cheapest end to end at 60 percent of `gpt-5.4`, but it delegates less and changes the filesystem less often.

The measurement counts direct children only. If those child sessions spawn their own children, those tokens are absent, so every figure is a floor. Child sessions also run their own seats on models that changed during this window. These numbers therefore compare task trees started under each orchestrator model, not the orchestrator models in isolation.

## The 5.6 tier structure

Sol, Terra, and Luna are capability tiers. Sol is flagship, Terra is the balanced mid-tier at roughly GPT-5.5 quality, and Luna is the lightweight low-cost tier. All are reasoning models with roughly 1M-token context. The `-fast` suffix changes latency within a tier.

Recorded `gpt-5.6-luna-fast` is already the cheapest tier. Its high delegation and unremarkable end-to-end cost are consistent with a weaker orchestrator scattering work to child sessions. Moving the seat to plain `gpt-5.6-luna` would repeat the mini experiment under another name.

As of 2026-09-01, no retirement has been announced for `gpt-5.4` or `gpt-5.4-mini`. OpenAI policy gives at least six months' notice before retiring GA models, and `gpt-5.4-mini` is being expanded in ChatGPT as a rate-limit fallback. There is no near-term migration deadline forcing a seat change.

Mini uses roughly 53 percent of `gpt-5.4`'s read tokens per session, but it also delegates less and produces filesystem changes less often. This data does not show mini doing equivalent work more cheaply. It is a negative finding about mini in this seat, not evidence for any other model.

## Retractions

Keep these claims withdrawn so they do not re-enter the record:

- The pre-2026-08-18 model was `gpt-5.5-fast`. A raw `session.model` query contradicts this.
- Cost-per-edit figures of 1.75M, 1.96M, and 0.83M read tokens per patch established a meaningful ranking. Patch parts are not a reliable proxy for work when delegation is in play: patches land on child sessions, include bookkeeping files such as `.agent/status.snapshot.json`, and vary with session slicing.
- `gpt-5.5-fast` does not exist. It is a listed available model; it simply was never run on this seat.

## Open questions

- The effect of adding serena to the orchestrator seat on 2026-08-30 is not measurable because only about ten sessions have run under it.
- The seat moved to `openai/gpt-5.6-terra` on 2026-09-01 and needs a week of accumulated sessions before the comparison against the `gpt-5.4` baseline can be rerun.
- Only 4 of 44 available models have any telemetry.
- `opencode-go/gpt-5.6-luna` would run on a separate quota from the OpenAI account if that subscription is current.
