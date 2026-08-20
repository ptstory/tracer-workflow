import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { latestConformingGateComment, parseGateBody, parseGateComment } from "./verdict";
import type { Verdict } from "./verdict";

const verdictExamples = readFileSync(
  new URL("../../skills/review-gate/references/verdict-examples.md", import.meta.url),
  "utf8",
);

function extractVerdictBlocks(text: string): string[] {
  return [...text.matchAll(/```verdict\s*\n([\s\S]*?)\n```/g)].map((match) => match[1]);
}

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

describe("verdict examples", () => {
  const blocks = extractVerdictBlocks(verdictExamples);

  test("contains four conforming verdict blocks", () => {
    expect(blocks).toHaveLength(4);
  });

  for (const [index, block] of blocks.entries()) {
    test(`block ${index + 1} parses and round-trips`, () => {
      const marker = block.match(/^## review-gate:\s*(merge-candidate|needs-fix|needs-human|blocked)\s*$/m)?.[1] as
        | Verdict
        | undefined;
      if (!marker) throw new Error("missing verdict marker");

      const parsed = parseGateBody(block);
      if (!parsed) throw new Error("expected conforming verdict block");
      expect(parsed.verdict).toBe(marker);

      const createdAt = `2026-02-0${index + 1}T00:00:00Z`;
      const latest = latestConformingGateComment([{ body: block, createdAt }]);

      if (!latest) throw new Error("expected latest conforming verdict");
      expect(latest).toEqual({
        ...parsed,
        commentedAt: createdAt,
      });
    });
  }

  test("keeps review-round contract semantics aligned with verdict state", () => {
    for (const block of blocks) {
      const parsed = parseGateBody(block);
      if (!parsed) throw new Error("expected conforming verdict block");

      expect(parsed.reviewRound < 3 || parsed.verdict === "needs-human").toBe(true);
    }
  });
});
