import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, test } from "bun:test";

import { latestConformingGateComment, parseGateBody, parseGateComment } from "./verdict";
import type { Comment } from "./verdict";
import type { Verdict } from "./verdict";

const verdictExamples = readFileSync(
  new URL("../../skills/review-gate/references/verdict-examples.md", import.meta.url),
  "utf8",
);

function extractVerdictBlocks(text: string): string[] {
  return [...text.matchAll(/```verdict\s*\n([\s\S]*?)\n```/g)].map((match) => match[1]);
}

beforeEach(() => { process.env.TRACER_REVIEWER_LOGINS = "reviewer"; });

describe("parseGateComment", () => {
  test("parses a conforming verdict with its round", () => {
    const comment = parseGateComment([
      {
        body: "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: 0\nreviewed-files: 3\nblocking-set: src/api.ts\n",
        author: { login: "reviewer" },
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

  test("ignores a newer untrusted marker and reports its author", () => {
    const warn = console.warn;
    const messages: string[] = [];
    console.warn = (message: string) => { messages.push(message); };
    try {
      const body = "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: 0\nreviewed-files: 1\nblocking-set: src/api.ts\n";
      const comments = [
        { author: { login: "reviewer" }, body, createdAt: "2026-01-01T00:00:00Z" },
        { author: { login: "attacker" }, body, createdAt: "2026-01-02T00:00:00Z" },
      ];
      expect(parseGateComment(comments).kind).toBe("parsed");
      expect(latestConformingGateComment(comments)?.commentedAt).toBe("2026-01-01T00:00:00Z");
      expect(messages).toContain("Ignoring review-gate comment from non-allowlisted author attacker");
    } finally {
      console.warn = warn;
    }
  });

  test("ignores a newer malformed trusted marker and keeps the latest conforming verdict", () => {
    process.env.TRACER_REVIEWER_LOGINS = "reviewer";
    const validBody = "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: 0\nreviewed-files: 1\nblocking-set: src/api.ts\n";
    const comments = [
      { author: { login: "reviewer" }, body: validBody, createdAt: "2026-01-01T00:00:00Z" },
      { author: { login: "reviewer" }, body: validBody.replace("review-round: 0\n", "review-round: zero\n"), createdAt: "2026-08-01T00:00:00Z" },
    ];

    expect(parseGateComment(comments)).toEqual({
      kind: "parsed",
      verdict: {
        verdict: "needs-fix",
        headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        reviewRound: 0,
        reviewedFiles: 1,
        commentedAt: "2026-01-01T00:00:00Z",
      },
    });
  });

  test("accepts historical verdicts without blocking-set or next-action before their schema cutoffs", () => {
    const legacyBody = "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: 0\nreviewed-files: 1\n";
    expect(parseGateComment([
      { author: { login: "reviewer" }, body: legacyBody, createdAt: "2026-09-01T11:00:00Z" },
    ], { pullRequestNumber: 98 }).kind).toBe("parsed");
  });

  test("validates present next-action and blocking-set rules and checks the target PR", () => {
    const legacyBody = "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: 0\nreviewed-files: 1\n";
    const legacyComment = { author: { login: "reviewer" }, body: legacyBody, createdAt: "2026-09-01T11:00:00Z" };
    expect(parseGateComment([legacyComment], { pullRequestNumber: 98 }).kind).toBe("parsed");

    const currentBody = `${legacyBody}blocking-set: src/api.ts\nnext-action: from-pr-review https://github.com/acme/repo/pull/98\n`;
    const currentComment: Comment = { ...legacyComment, body: currentBody };
    expect(parseGateComment([currentComment], { pullRequestNumber: 98 }).kind).toBe("parsed");
    expect(parseGateComment([currentComment], { pullRequestNumber: 99 }).kind).toBe("invalid");
  });

  test("returns a validated next action and supports explicit trusted reviewer logins", () => {
    const comment: Comment = {
      author: { login: "Review-Bot" },
      body: "## review-gate: needs-human\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: 0\nreviewed-files: 1\nblocking-set:\nnext-action: gh pr view 98 --web\n",
      createdAt: "2026-09-26T20:18:26Z",
    };

    expect(parseGateComment([comment], { pullRequestNumber: 98, trustedReviewerLogins: ["review-bot"] })).toEqual({
      kind: "parsed",
      verdict: {
        verdict: "needs-human",
        headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        reviewRound: 0,
        reviewedFiles: 1,
        commentedAt: "2026-09-26T20:18:26Z",
        nextAction: "gh pr view 98 --web",
      },
    });
  });

  test("fails closed without an allowlist", () => {
    delete process.env.TRACER_REVIEWER_LOGINS;
    expect(() => parseGateComment([])).toThrow("TRACER_REVIEWER_LOGINS");
    expect(() => latestConformingGateComment([])).toThrow("TRACER_REVIEWER_LOGINS");
  });

  test("returns none when there is no verdict marker", () => {
    expect(
      parseGateComment([
        {
          body: "not a gate comment",
          author: { login: "reviewer" },
        createdAt: "2026-01-03T00:00:00Z",
        },
      ]),
    ).toEqual({ kind: "none" });
  });

  test("rejects a new verdict with a state-inappropriate next action", () => {
    const body = "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: 0\nreviewed-files: 1\nblocking-set: src/api.ts\nnext-action: nonsense\n";
    expect(parseGateComment([
      { author: { login: "reviewer" }, body, createdAt: "2026-09-26T20:18:26Z" },
    ], { pullRequestNumber: 98 }).kind).toBe("invalid");
  });

  test("rejects a needs-fix verdict with an empty blocking set", () => {
    const body = "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: 0\nreviewed-files: 1\nblocking-set:\nnext-action: from-pr-review https://github.com/acme/repo/pull/98\n";
    expect(parseGateComment([
      { author: { login: "reviewer" }, body, createdAt: "2026-09-26T20:18:26Z" },
    ], { pullRequestNumber: 98 }).kind).toBe("invalid");
  });

  test("treats a verdict missing review-round as invalid", () => {
    expect(
      parseGateComment([
        {
          body: "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreviewed-files: 1\n",
          author: { login: "reviewer" },
        createdAt: "2026-01-04T00:00:00Z",
        },
      ]),
    ).toEqual({
      kind: "invalid",
      comment: {
        body: "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreviewed-files: 1\n",
        author: { login: "reviewer" },
        createdAt: "2026-01-04T00:00:00Z",
      },
    });
  });

  test("treats a verdict with non-integer review-round as invalid", () => {
    expect(
      parseGateComment([
        {
          body: "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: zero\nreviewed-files: 1\n",
          author: { login: "reviewer" },
        createdAt: "2026-01-01T00:00:00Z",
        },
      ]),
    ).toEqual({
      kind: "invalid",
      comment: {
        body: "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: zero\nreviewed-files: 1\n",
        author: { login: "reviewer" },
        createdAt: "2026-01-01T00:00:00Z",
      },
    });
  });
});

describe("verdict examples", () => {
  const blocks = extractVerdictBlocks(verdictExamples);
  const mergeCandidateBlocks = blocks.filter((block) => /^## review-gate:\s*merge-candidate\s*$/m.test(block));

  test("contains fourteen conforming verdict blocks", () => {
    expect(blocks).toHaveLength(14);
  });

  test("covers verdict precedence for draft, human stops, and blockers", () => {
    const draftBlock = blocks.find((block) => block.includes("next-action: gh pr ready 123"));
    expect(draftBlock).toBeDefined();
    expect(parseGateBody(draftBlock ?? "")?.verdict).toBe("merge-candidate");

    expect(blocks.some((block) => block.includes("review-gate: needs-fix") && block.includes("readiness evidence path: indeterminate"))).toBe(true);
    expect(blocks.some((block) => block.includes("Door: one-way") && block.includes("review-gate: needs-human"))).toBe(true);
    expect(blocks.some((block) => block.includes("Door: one-way") && block.includes("review-gate: needs-fix"))).toBe(true);
    expect(blocks.some((block) => block.includes("circuit breaker triggered after two prior corrective rounds") && block.includes("review-gate: needs-human"))).toBe(true);
    const humanStopBlock = blocks.find((block) => block.includes("explicit human-only finding takes precedence"));
    expect(humanStopBlock).toBeDefined();
    expect(parseGateBody(humanStopBlock ?? "")?.verdict).toBe("needs-human");
    expect(humanStopBlock).toMatch(/^blocking-set:\s*$/m);
    expect(humanStopBlock).toContain("[fix-now]");

    const prBodyBlock = blocks.find((block) => block.includes("PR-body contract violation"));
    expect(prBodyBlock).toBeDefined();
    expect(parseGateBody(prBodyBlock ?? "")?.verdict).toBe("needs-fix");
    expect(prBodyBlock).toContain("blocking-set: PR body");
    expect(prBodyBlock).toContain("edit the PR description directly");
  });

  test("documents round continuity from a legacy verdict to the current writer schema", () => {
    const legacyHeader = verdictExamples.match(/```text\n(## review-gate: needs-fix\n[\s\S]*?)\n```/)?.[1];
    expect(legacyHeader).toBeDefined();
    expect(legacyHeader).toContain("review-round: 0");
    expect(legacyHeader).toContain("blocking-set: src/auth.ts");
    expect(legacyHeader).not.toContain("next-action:");
    expect(verdictExamples).toContain("The missing `next-action:` does not erase that valid prior round.");
    expect(parseGateBody(mergeCandidateBlocks[1])?.reviewRound).toBe(1);
    expect(mergeCandidateBlocks[1]).toContain("next-action: gh pr merge 123");
  });

  test("includes four merge-candidate examples and they parse", () => {
    expect(mergeCandidateBlocks).toHaveLength(4);

    expect(
      mergeCandidateBlocks.map((block) => {
        const parsed = parseGateBody(block);
        if (!parsed) throw new Error("expected conforming verdict block");
        expect(parsed.verdict).toBe("merge-candidate");
        return parsed.reviewRound;
      }),
    ).toEqual([0, 1, 0, 0]);
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
      const latest = latestConformingGateComment([{ author: { login: "reviewer" }, body: block, createdAt }]);

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
