# Luna vs Sol routing spot check — 2026-10-01

## Question

For this Crush-based software workflow, is `gpt-6-luna` at Max good enough to be the normal first executor, with `gpt-6.1-sol` at High reserved for escalation?

This was a **bounded, pragmatic spot check**, not a general model benchmark.

## Scope

- 4 paired repository tasks
- 8 valid decision runs total
- Same task/base conditions within each pair
- Hidden-test correctness as the primary outcome
- Historical replay intentionally stopped after 4 pairs rather than completing the original 24-run preregistration

Because the 24-run protocol was not completed, these results should **not** be interpreted as population-level accuracy estimates or a general claim that either model is better.

## Paired correctness results

Task labels are intentionally anonymized because the source repositories are private.

| Task | Luna / Max | Sol / High |
|---|---:|---:|
| `Task A` | FAIL | FAIL |
| `Task B` | PASS | PASS |
| `Task C` | FAIL | PASS |
| `Task D` | PASS | PASS |

Summary:

- Luna: **2/4**
- Sol: **3/4**
- Ties: **3 pairs**
- Unique Sol wins: **1**
- Unique Luna wins: **0**

The unique Sol win was substantive but narrow: Luna implemented the intended architecture but substituted presentation-layer identifiers for canonical data identities at an existing identity boundary. Sol preserved that boundary and passed.

On `Task D`—the sampled task most representative of messy integration / repo archaeology—both models passed.

## Efficiency

Across the four valid decision runs per model:

| Metric | Luna / Max | Sol / High |
|---|---:|---:|
| Total session wall time | **646 s** | **1,665 s** |
| Average wall time / run | **161.5 s** | **416.3 s** |
| Recorded cumulative session cost | **$0.285483** | **$6.327426** |
| Average recorded cost / run | **$0.0714** | **$1.5819** |

Sol relative to Luna:

- **2.58×** wall time
- **22.16×** recorded cost

## Token-accounting correction

An earlier analysis summed Crush's saved `prompt_tokens`, `completion_tokens`, and `total_tokens` fields and described that as cumulative token consumption.

That interpretation was wrong.

Current Crush behavior accumulates `session.cost`, but the saved token counters are replaced with the latest model step's context/output usage. They are useful as **end-of-session context snapshots**, not cumulative session token spend.

Therefore:

- the earlier “Sol used ~1.34× the tokens” claim is withdrawn;
- cumulative cost and wall-time comparisons above remain valid;
- production telemetry should not aggregate these token fields as spend.

## What this supports

The evidence does **not** show that Luna is equally capable to Sol.

It does show that, in this bounded sample:

- Luna matched Sol on 3 of 4 paired outcomes;
- Sol produced one real correctness win;
- Luna was dramatically cheaper and faster;
- Luna still passed the sampled integration-heavy Task D.

That supports **piloting a routing policy and measuring it end-to-end**, rather than declaring a winner-take-all model choice. The experiment directly measured model attempts against hidden tests; it did **not** validate the complete Luna → Review Gate → repair → Sol router.

## What remains unvalidated

The largest remaining uncertainty is **Review Gate recall on substantive semantic failures**.

The proposed production system does not blindly trust Luna; it relies on Review Gate to catch the cases where Luna should be repaired or escalated. But the spot check graded model output with hidden tests. It did not test whether Review Gate would have caught Luna's canonical-identity miss on Task C before acceptance.

The spot check also did not exercise the proposed **one Luna repair cycle**. So it does not yet tell us:

- how often Luna passes Review Gate on the first attempt;
- how often a Luna repair resolves a substantive finding;
- how often Review Gate misses a defect that hidden tests or later production behavior would catch;
- how often a Sol escalation actually converts a persistent Luna failure into an accepted change.

Those are properties of the **routing system**, not of either model in isolation, and they are the main target of production telemetry.

## Economic sanity check

Using the observed average recorded costs and wall times as a rough planning model, and temporarily ignoring Review Gate / repair overhead:

- average Luna run: **$0.0714** and **161.5 s**;
- average Sol run: **$1.5819** and **416.3 s**.

If every job starts on Luna and a fraction `p` later reruns on Sol, expected model cost is approximately:

```text
Luna cost + p × Sol cost
```

That remains below going directly to Sol until `p ≈ 95.5%`.

For sequential wall time, the analogous break-even is much lower: roughly `p ≈ 61.2%`, because escalated jobs pay the Luna time before paying the Sol time.

These are **sanity checks, not forecasts**. The real router includes Review Gate latency and, for ordinary findings, one Luna repair cycle; both make the time break-even less favorable than 61.2%. This is why production measurement should focus on accepted-change cost/time for the whole route rather than standalone per-model averages.

## Production routing policy

```text
Luna / Max
   ↓
Review Gate
   ↓
PASS ──────────────→ done
   ↓ needs-fix
ordinary/local repair?
   ├─ yes → Luna repairs once → Review Gate
   │                            ├─ PASS → done
   │                            └─ substantive failure persists → Sol / High
   │
   └─ deep semantic / identity / cross-system contract miss → Sol / High
```

In short:

> **Pilot Luna as the default first executor. Let Review Gate be the escalation sensor. Give Luna one repair cycle for ordinary/local findings. Escalate to Sol when a substantive correctness or integration problem persists, or immediately when the first review exposes a deep semantic/contract miss. Treat this as a monitored production hypothesis until end-to-end telemetry validates the gate and repair behavior.**

## Next phase

The more useful question is no longer “Which model is better?”

It is:

> **Which routing policy produces accepted changes most efficiently?**

Production telemetry is being added to record normal work passively and validate the router itself, including:

- Luna first-pass acceptance rate
- Luna repair success rate
- Sol escalation rate
- Sol escalation success rate
- Review Gate rounds
- cumulative recorded model cost
- wall time
- final context footprint

That evidence comes from work that needed to happen anyway rather than from more disposable historical replays.
