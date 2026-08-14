import { describe, expect, test } from "bun:test";

import { parseGateComment } from "./verdict";

describe("parseGateComment", () => {
  test("returns the latest valid gate comment by createdAt", () => {
    const comment = parseGateComment([
      {
        body: "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        body: "## review-gate: merge-candidate\nhead-sha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
        createdAt: "2026-01-02T00:00:00Z",
      },
    ]);

    expect(comment).toEqual({
      verdict: "merge-candidate",
      headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      commentedAt: "2026-01-02T00:00:00Z",
    });
  });

  test("skips non-gate and malformed gate comments", () => {
    expect(
      parseGateComment([
        {
          body: "not a gate comment",
          createdAt: "2026-01-03T00:00:00Z",
        },
        {
          body: "## review-gate: needs-fix\nno head sha\n",
          createdAt: "2026-01-04T00:00:00Z",
        },
        {
          body: "## review-gate: unknown\nhead-sha: cccccccccccccccccccccccccccccccccccccccc\n",
          createdAt: "2026-01-05T00:00:00Z",
        },
      ]),
    ).toBeNull();
  });
});
