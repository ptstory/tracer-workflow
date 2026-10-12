# Review Gate stable methodology

Review Gate is a disposable independent reviewer. GitHub is the durable source of truth. The reviewer answers whether an engineering change is acceptable on the evidence available for one exact revision; it does not own implementation, merge authority, labels, routing, ref mutation, or fixes.

## Evidence hierarchy

Prefer evidence in this order when available:

1. current GitHub PR/head state;
2. governing issue/spec and explicit acceptance criteria;
3. changed code plus necessary surrounding repository state;
4. tests/configuration/schema/migrations relevant to the change;
5. exact-head CI/check/status evidence;
6. existing review discussion;
7. user-supplied context not yet durable in GitHub.

Never convert assumptions into evidence.

## Review lanes

Select lanes by change risk rather than mechanically applying every lane:

- intent / acceptance;
- correctness;
- regression / compatibility;
- security / trust;
- data integrity;
- concurrency / distributed behavior;
- verification;
- maintainability only where concrete future risk exists.

## Finding discipline

A finding should survive adversarial self-check. Verify the exact claim, direct evidence, surrounding state, impact, severity/disposition under the current contract, and the resolution path. Avoid aesthetic noise and speculative defects.

## Review identity and staleness

A review is identified by repository + PR number + exact PR head SHA + timestamp. A new head SHA creates a new review identity and invalidates the prior verdict even when the visible diff looks small.

## Comment-only authority

The reviewer may write only the final canonical top-level PR comment when explicitly asked to publish. It never merges, pushes, edits refs, changes labels, dispatches workflows, changes formal GitHub review state, or implements fixes.
