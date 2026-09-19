import { describe, expect, test } from "bun:test";

import { findAppendOnlyViolation } from "./check-radar-append-only";

const base = `This file is append-only.

## alpha
- Value: one

## beta
- Value: two
`;

describe("RADAR append-only validation", () => {
  test("allows appending a new entry with normal blank-line separation", () => {
    const current = `${base}
## gamma
- Value: three
`;

    expect(findAppendOnlyViolation(base, current)).toBeNull();
  });

  test("allows inserting a new entry between preserved entries", () => {
    const current = `This file is append-only.

## alpha
- Value: one

## inserted
- Value: new

## beta
- Value: two
`;

    expect(findAppendOnlyViolation(base, current)).toBeNull();
  });

  test("rejects editing an existing entry", () => {
    const current = base.replace("- Value: one", "- Value: changed");

    expect(findAppendOnlyViolation(base, current)).toBe("## alpha");
  });

  test("rejects deleting an existing entry", () => {
    const current = `This file is append-only.

## alpha
- Value: one
`;

    expect(findAppendOnlyViolation(base, current)).toBe("## beta");
  });

  test("rejects reordering existing entries", () => {
    const current = `This file is append-only.

## beta
- Value: two

## alpha
- Value: one
`;

    expect(findAppendOnlyViolation(base, current)).toBe("## beta");
  });

  test("does not normalize whitespace that belongs to entry content", () => {
    const current = base.replace("- Value: one\n", "- Value: one  \n");

    expect(findAppendOnlyViolation(base, current)).toBe("## alpha");
  });
});
