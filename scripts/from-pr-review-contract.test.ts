import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const skill = readFileSync(resolve(import.meta.dir, "../skills/from-pr-review/SKILL.md"), "utf8");
const handoff = readFileSync(
  resolve(import.meta.dir, "../skills/from-pr-review/references/handoff-shape.md"),
  "utf8",
);
const verdictContract = readFileSync(
  resolve(import.meta.dir, "../skills/review-gate/references/verdict-contract.md"),
  "utf8",
);

describe("from-pr-review return contract", () => {
  test("checks out only the resolved PR head and trusted verdict SHA", () => {
    expect(skill).toMatch(/gh pr checkout <N> --repo <OWNER\/REPO>/);
    expect(skill).toMatch(/git rev-parse HEAD/);
    expect(skill).toMatch(/matches the trusted verdict's `head-sha` before editing/);
  });

  test("runs the authorized fix pass even when the next corrective round reaches the breaker", () => {
    expect(skill).toMatch(/Do not refuse a current `needs-fix`\s+pass because the next corrective review is expected to trip the circuit breaker;\s+execute its authorized `fix-now` rows and state that the subsequent review is\s+expected to return `needs-human`/);
  });

  test("routes no-push dispositions away from the fixer and preserves the no-change guard", () => {
    expect(skill).toMatch(/head is\s+unchanged and no `fix-now` rows remain[\s\S]*?use `@review-gate <PR_URL>` as the\s+next action/);
    expect(skill).toMatch(/Never name `from-pr-review`[\s\S]*?as the next action for the same PR/);
    expect(skill).toMatch(/no finding, disposition, thread, or PR\s+body changed during this pass[\s\S]*?duplicate review at the\s+unchanged head/);
    expect(handoff).toMatch(/Next action: <one fresh-session invocation or `nothing — done`>/);
    expect(handoff).toMatch(/If no push occurred, no new\s+disposition or PR-body change was made[\s\S]*?do not trigger\s+a duplicate review/);
  });

  test("waits for settled current-head CI and handles pending and red outcomes", () => {
    expect(skill).toMatch(/every\s+30 seconds, for no more than 20 completed polls/);
    expect(skill).toMatch(/If checks remain pending\s+at the poll limit, report `blocked-on: checks pending`/);
    expect(skill).toMatch(/repair an in-scope\s+failure in this same run[\s\S]*?restart this step/);
    expect(skill).toMatch(/Once per poll, read the PR\s+head again[\s\S]*?restart verification for the new SHA/);
    expect(handoff).toMatch(/checks never settle \(still pending after the poll budget\)[\s\S]*?`blocked-on: checks pending`/);
    expect(handoff).toMatch(/A failure caused\s+by this pass is repaired in the same pass/);
  });

  test("uses canonical readiness semantics and tracks metadata findings in body history", () => {
    expect(skill).toMatch(/PR-metadata findings using the PR body's change history/);
    expect(skill).toMatch(/canonical contract in\s+`skills\/review-gate\/references\/verdict-contract\.md`/);
    expect(skill).toMatch(/`plan-unavailable` path[\s\S]*?not by itself a blocker/);
    expect(skill).toMatch(/`indeterminate` readiness remains blocked/);
    expect(handoff).toMatch(/Readiness evidence path: <available\|plan-unavailable\|indeterminate>/);
    expect(handoff).toMatch(/`plan-unavailable` is not by itself a blocker/);
    expect(handoff).toMatch(/`indeterminate` readiness is blocked/);
    expect(verdictContract).toMatch(/Record the readiness evidence path in the Review Record as `available`, `plan-unavailable`, or `indeterminate`/);
    expect(verdictContract).toMatch(/HTTP 403 with the exact body message[\s\S]*?records `plan-unavailable`/);
  });
});
