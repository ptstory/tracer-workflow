import { describe, expect, test } from "bun:test";

import { parseGateComment } from "./verdict";

describe("parseGateComment", () => {
  test("parses a conforming verdict with its round", () => {
    const comment = parseGateComment([
      {
        body: "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: 0\nreviewed-files: 3\n",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);

    expect(comment).toEqual({
      kind: "parsed",
      verdict: {
        verdict: "needs-fix",
        headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        reviewRound: 0,
        reviewedFiles: 3,
        commentedAt: "2026-01-01T00:00:00Z",
      },
    });
  });

  test("returns none when there is no verdict marker", () => {
    expect(
      parseGateComment([
        {
          body: "not a gate comment",
          createdAt: "2026-01-03T00:00:00Z",
        },
      ]),
    ).toEqual({ kind: "none" });
  });

  test("treats a verdict missing review-round as invalid", () => {
    expect(
      parseGateComment([
        {
          body: "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreviewed-files: 1\n",
          createdAt: "2026-01-04T00:00:00Z",
        },
      ]),
    ).toEqual({
      kind: "invalid",
      comment: {
        body: "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreviewed-files: 1\n",
        createdAt: "2026-01-04T00:00:00Z",
      },
    });
  });

  test("treats a verdict with non-integer review-round as invalid", () => {
    expect(
      parseGateComment([
        {
          body: "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: zero\nreviewed-files: 1\n",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ]),
    ).toEqual({
      kind: "invalid",
      comment: {
        body: "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: zero\nreviewed-files: 1\n",
        createdAt: "2026-01-01T00:00:00Z",
      },
    });
  });
});
