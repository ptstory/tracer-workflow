## The fence

The orchestrator seat originally had to be fenced because it kept doing implementation work itself instead of delegating. To stop that pattern, edit and bash were both set to deny on the seat, and chisel and serena were denied as well. The point was simple: remove the orchestrator's direct ability to act so that the only remaining path was to spawn an executor or fixer and keep the seat focused on orchestration. By the numbers, that worked. Orchestrator bash share fell from 60.6 percent to 0 percent, executor share rose from 10.6 percent to 89.6 percent, and 97 orchestrator-to-executor child sessions were observed.

## Why the fence came off

The fence solved the first problem, but it created a second one: a double-payment pattern. The orchestrator would diagnose a problem, then be unable to act on it, then spend another cycle re-planning the same work for a child session. The clearest example was core-tweaks issue 10, where a single-file mobile CSS fix stretched to 2 hours and 16 minutes. That was the point at which the restriction stopped looking like discipline and started looking like waste, so the permissions were flipped back to allow on 2026-08-12.

## The two record errors that kept forcing re-derivation

This history had to be reconstructed more than once because two errors in the record kept getting repeated.

The first error was that the unfencing was only half-applied for more than two weeks. The orchestrator `mcps` array is an allowlist, not a modifier list, so removing the `!serena` and `!chisel` negations did not actually grant those tools. From 2026-08-12 through 2026-08-30, the seat had full edit and bash permissions but no symbol tools. In practice that meant it was re-reading files to answer questions that a symbol index could have answered directly. Serena was finally added to that array on 2026-08-30.

The second error was a model-identification mistake that hardened into folklore. A 2026-08-21 audit concluded that the pre-2026-08-18 orchestrator model was `gpt-5.5-fast`, and later sessions repeated that as if it were settled fact. It is false. A raw query of `session.model` against `opencode.db` on 2026-09-01 shows a different sequence: `gpt-5.4-mini` ran the seat through 2026-08-12, both `gpt-5.4-mini` and `gpt-5.4` appear on 2026-08-14, `gpt-5.6-luna-fast` appears on 2026-08-16 through 2026-08-18, `gpt-5.4` runs from 2026-08-18 onward, and `gpt-5.4-mini` reappears on 2026-08-28, 2026-08-29, and 2026-08-31. The seat model is not stable because quick-switching is in use, so any seat telemetry grouped only by date is contaminated. Model has to be the grouping key rather than the date bucket.

## What is measured and what is not

From 2026-08-13 onward, the usable orchestrator-seat telemetry groups more cleanly by model than by date. On `gpt-5.4`, there are 80 sessions, with 179,548 input tokens and 2,648,590 total read tokens per session, 1.96 children spawned per session, and 59 percent of sessions spawning at least one child. On `gpt-5.4-mini`, there are 14 sessions, with 107,651 input tokens and 1,397,159 total read tokens per session, 1.36 children per session, and 43 percent spawning a child. On `gpt-5.6-luna-fast`, there are 9 sessions, with 446,412 input tokens and 1,843,276 total read tokens per session, 3.44 children per session, and 56 percent spawning a child.

The negative finding matters more than any easy headline. Mini uses roughly 53 percent of `gpt-5.4`'s read tokens per session, but it also delegates less and produces filesystem changes less often. There is no reading of this data in which mini is doing equivalent work more cheaply. That is a negative finding about mini in this seat, not a positive finding being claimed here about any other model.

## Retractions

Several claims need to stay explicitly withdrawn so they do not get repeated.

The first is that the pre-2026-08-18 model was `gpt-5.5-fast`. That is false.

The second is that cost-per-edit figures of 1.75M, 1.96M, and 0.83M read tokens per patch established a meaningful ranking. That claim is withdrawn because patch parts are not a reliable proxy for work when delegation is in play: patches land on child sessions, they include bookkeeping files such as `.agent/status.snapshot.json`, and the numbers are highly sensitive to how finely sessions are sliced.

The third is that `gpt-5.5-fast` does not exist. That is also false. It is a listed available model; it simply was never run on this seat.

## Open questions

The remaining gaps are straightforward. Total cost per orchestrator task, including child-session tokens, is still unmeasured. The option space is wider than the current evidence base: there are 44 available models, but only 4 have any telemetry at all. And `opencode-go/gpt-5.6-luna` would run on a separate quota from the OpenAI account if that subscription is current.
