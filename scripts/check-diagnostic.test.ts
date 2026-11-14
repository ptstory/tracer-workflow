import { describe, expect, test } from "bun:test";

import { formatCheckDiagnostic } from "./check-diagnostic";

describe("check diagnostic formatting", () => {
  test("reports expected, found, and recovery action in a stable shape", () => {
    expect(formatCheckDiagnostic("expected value", "found value", "take action"))
      .toBe("Expected: expected value; found: found value; action: take action");
  });
});
