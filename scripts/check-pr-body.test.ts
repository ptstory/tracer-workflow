import { describe, expect, test } from "bun:test";

import { validatePrBody } from "./check-pr-body";

const sha = "a".repeat(40);
const valid = `Closes #160

## Summary

A diagram.

## Evidence

- Head SHA: ${sha}
- Verification: bun test (exit 0)

## Merge Danger

Door: two-way

## Docs

Updated the PR body contract.
`;

describe("PR body validation", () => {
  test("accepts a complete body for the current head", () => {
    expect(validatePrBody(valid, sha)).toEqual([]);
  });

  test("accepts alternative closing verbs and qualified issue references", () => {
    expect(validatePrBody(valid.replace("Closes #160", "Resolves ptstory/tracer-workflow#160"), sha)).toEqual([]);
    expect(validatePrBody(valid.replace("Closes #160", "Fixes #160"), sha)).toEqual([]);
  });

  test("rejects a missing closing reference", () => {
    expect(validatePrBody(valid.replace("Closes #160", "Related to #160"), sha)).toContain("missing Fixes/Closes/Resolves issue reference");
  });

  test("rejects each missing section, not mentions in prose", () => {
    for (const section of ["Summary", "Evidence", "Merge Danger", "Docs"]) {
      expect(validatePrBody(valid.replace(`## ${section}`, `Note: ${section}`), sha)).toContain(`missing ## ${section} section`);
    }
  });

  test("rejects a stale, malformed, or misplaced SHA", () => {
    expect(validatePrBody(valid, "b".repeat(40))).toContain("Evidence Head SHA does not match the current PR head SHA");
    expect(validatePrBody(valid.replace(sha, "a".repeat(39)), sha)).toContain("Evidence Head SHA does not match the current PR head SHA");
    expect(validatePrBody(valid.replace(`- Head SHA: ${sha}`, "No head SHA"), sha)).toContain("Evidence Head SHA does not match the current PR head SHA");
  });
});
