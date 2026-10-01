import { describe, expect, test } from "bun:test";
import {
  buildTaskLifecycle,
  median,
  normalizeGitHubRemote,
  reviewEvents,
  summarizeSession,
  type AttemptRecord,
  type ReviewEvent,
} from "./lib";

describe("normalizeGitHubRemote", () => {
  test("normalizes SSH and HTTPS GitHub origins", () => {
    expect(normalizeGitHubRemote("git@github.com:ptstory/thread-atlas.git")).toBe("ptstory/thread-atlas");
    expect(normalizeGitHubRemote("https://github.com/ptstory/thread-atlas.git")).toBe("ptstory/thread-atlas");
    expect(normalizeGitHubRemote("ssh://git@github.com/ptstory/thread-atlas")).toBe("ptstory/thread-atlas");
    expect(normalizeGitHubRemote("https://gitlab.com/ptstory/thread-atlas.git")).toBeNull();
  });
});

describe("summarizeSession", () => {
  test("extracts model, tokens, wall time, tool calls and skills without transcript text", () => {
    const summary = summarizeSession({
      meta: {
        prompt_tokens: 1200,
        completion_tokens: 50,
        total_tokens: 1300,
        cost: 0.42,
        reasoning_effort: "max",
        skills: [{ name: "from-issue" }],
      },
      messages: [
        { role: "user", created: "2026-10-01T10:00:00Z" },
        {
          role: "assistant",
          created: "2026-10-01T10:00:05Z",
          model: "gpt-6-luna",
          parts: [{ type: "tool_call", name: "view" }],
        },
        {
          role: "assistant",
          created: "2026-10-01T10:02:05Z",
          model: "gpt-6-luna",
          parts: [{ type: "tool_call", name: "agent" }],
        },
      ],
    });

    expect(summary).toEqual({
      models: ["gpt-6-luna"],
      reasoningEfforts: ["max"],
      assistantMessages: 2,
      toolCalls: 2,
      subagentCalls: 1,
      firstAt: "2026-10-01T10:00:00.000Z",
      lastAt: "2026-10-01T10:02:05.000Z",
      wallSeconds: 125,
      promptTokens: 1200,
      completionTokens: 50,
      totalTokens: 1300,
      cost: 0.42,
      skills: ["from-issue"],
    });
  });
});

describe("reviewEvents", () => {
  test("accepts allowlisted conforming verdicts and derives blocking/fix-now telemetry", () => {
    const events = reviewEvents(
      "ptstory/example",
      12,
      [
        {
          author: { login: "review-bot" },
          createdAt: "2026-10-01T10:05:00Z",
          body: [
            "## review-gate: needs-fix",
            "head-sha: 1111111111111111111111111111111111111111",
            "review-round: 0",
            "reviewed-files: 3",
            "blocking-set: src/a.ts, test/a.test.ts",
            "",
            "### Standards",
            "- [high] [fix-now] src/a.ts — broken",
            "- [medium] [fix-now] test/a.test.ts — missing coverage",
          ].join("\n"),
        },
        {
          author: { login: "random-user" },
          createdAt: "2026-10-01T10:06:00Z",
          body: [
            "## review-gate: merge-candidate",
            "head-sha: 2222222222222222222222222222222222222222",
            "review-round: 1",
            "reviewed-files: 3",
          ].join("\n"),
        },
      ],
      new Set(["review-bot"]),
    );

    expect(events).toEqual([
      {
        repo: "ptstory/example",
        prNumber: 12,
        verdict: "needs-fix",
        headSha: "1111111111111111111111111111111111111111",
        reviewRound: 0,
        reviewedFiles: 3,
        blockingSet: ["src/a.ts", "test/a.test.ts"],
        fixNowCount: 2,
        commentedAt: "2026-10-01T10:05:00Z",
      },
    ]);
  });
});

function attempt(overrides: Partial<AttemptRecord>): AttemptRecord {
  return {
    version: 1,
    sessionId: "s",
    cwd: "/tmp/repo",
    projectDir: "/tmp/repo",
    firstSeenAt: "2026-10-01T10:00:00Z",
    repo: "ptstory/example",
    branch: "issue-12",
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    capturedAt: "2026-10-01T10:03:00Z",
    prNumber: 12,
    issueNumbers: [12],
    prState: "OPEN",
    prMergedAt: null,
    models: ["gpt-6-luna"],
    reasoningEfforts: ["max"],
    assistantMessages: 1,
    toolCalls: 4,
    subagentCalls: 0,
    firstAt: "2026-10-01T10:00:00Z",
    lastAt: "2026-10-01T10:02:00Z",
    wallSeconds: 120,
    promptTokens: 1000,
    completionTokens: 100,
    totalTokens: 1100,
    cost: 0.1,
    skills: ["from-issue"],
    ...overrides,
  };
}

function review(overrides: Partial<ReviewEvent>): ReviewEvent {
  return {
    repo: "ptstory/example",
    prNumber: 12,
    verdict: "needs-fix",
    headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    reviewRound: 0,
    reviewedFiles: 2,
    blockingSet: ["src/a.ts"],
    fixNowCount: 1,
    commentedAt: "2026-10-01T10:05:00Z",
    ...overrides,
  };
}

describe("buildTaskLifecycle", () => {
  test("classifies Luna repair then Sol escalation and joins reviews by chronology", () => {
    const attempts = [
      attempt({ sessionId: "luna-1" }),
      attempt({
        sessionId: "luna-2",
        firstSeenAt: "2026-10-01T10:10:00Z",
        firstAt: "2026-10-01T10:10:00Z",
        lastAt: "2026-10-01T10:12:00Z",
        totalTokens: 900,
      }),
      attempt({
        sessionId: "sol-1",
        firstSeenAt: "2026-10-01T10:20:00Z",
        firstAt: "2026-10-01T10:20:00Z",
        lastAt: "2026-10-01T10:25:00Z",
        models: ["gpt-6.1-sol"],
        reasoningEfforts: ["high"],
        totalTokens: 2000,
        wallSeconds: 300,
        cost: 1.2,
      }),
    ];
    const reviews = [
      review({ commentedAt: "2026-10-01T10:05:00Z", reviewRound: 0 }),
      review({ commentedAt: "2026-10-01T10:15:00Z", reviewRound: 1 }),
      review({
        commentedAt: "2026-10-01T10:30:00Z",
        reviewRound: 2,
        verdict: "merge-candidate",
        blockingSet: [],
        fixNowCount: 0,
      }),
    ];

    const [lifecycle] = buildTaskLifecycle(attempts, reviews);
    expect(lifecycle.attempts.map((item) => item.phase)).toEqual(["initial", "repair", "escalation"]);
    expect(lifecycle.attempts.map((item) => item.review?.verdict)).toEqual([
      "needs-fix",
      "needs-fix",
      "merge-candidate",
    ]);
    expect(lifecycle.accepted).toBe(true);
    expect(lifecycle.firstPassLunaAccepted).toBe(false);
    expect(lifecycle.lunaRepairSucceeded).toBe(false);
    expect(lifecycle.escalatedToSol).toBe(true);
    expect(lifecycle.solEscalationSucceeded).toBe(true);
    expect(lifecycle.reviewRounds).toBe(3);
    expect(lifecycle.totalTokens).toBe(4000);
  });

  test("counts a one-repair Luna success without escalation", () => {
    const attempts = [
      attempt({ sessionId: "luna-1" }),
      attempt({
        sessionId: "luna-2",
        firstSeenAt: "2026-10-01T10:10:00Z",
        firstAt: "2026-10-01T10:10:00Z",
        lastAt: "2026-10-01T10:12:00Z",
      }),
    ];
    const reviews = [
      review({ commentedAt: "2026-10-01T10:05:00Z" }),
      review({
        commentedAt: "2026-10-01T10:15:00Z",
        reviewRound: 1,
        verdict: "merge-candidate",
        blockingSet: [],
        fixNowCount: 0,
      }),
    ];
    const [lifecycle] = buildTaskLifecycle(attempts, reviews);
    expect(lifecycle.lunaRepairSucceeded).toBe(true);
    expect(lifecycle.escalatedToSol).toBe(false);
  });
});

describe("median", () => {
  test("returns null for empty and midpoint for odd/even samples", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
