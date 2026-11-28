import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  attributableAllowanceObservations,
  allowlistedSessionFields,
  buildTaskLifecycle,
  identityObservation,
  median,
  normalizeGitHubRemote,
  parseCorrectivePullRequestReferences,
  reviewEvents,
  summarizeSession,
  validateAllowanceObservation,
  type AllowanceObservation,
  type AttemptRecord,
  type ReviewEvent,
} from "./lib";

const telemetryCli = join(import.meta.dir, "model-telemetry.ts");

describe("normalizeGitHubRemote", () => {
  test("normalizes SSH and HTTPS GitHub origins", () => {
    expect(normalizeGitHubRemote("git@github.com:sample-owner/thread-atlas.git")).toBe("sample-owner/thread-atlas");
    expect(normalizeGitHubRemote("https://github.com/sample-owner/thread-atlas.git")).toBe("sample-owner/thread-atlas");
    expect(normalizeGitHubRemote("ssh://git@github.com/sample-owner/thread-atlas")).toBe("sample-owner/thread-atlas");
    expect(normalizeGitHubRemote("https://gitlab.com/sample-owner/thread-atlas.git")).toBeNull();
  });
});

describe("session identity and metrics", () => {
  test("represents missing reasoning effort and observed model as unknown", () => {
    const metrics = summarizeSession({ messages: [{ role: "assistant" }] }, "configured-model");
    expect(metrics.configuredModel).toBe("configured-model");
    expect(metrics.observedModel).toEqual({ status: "unknown" });
    expect(metrics.observedReasoningEffort).toEqual({ status: "unknown" });
  });

  test("represents multiple observed models as mixed and keeps configured identity separate", () => {
    const metrics = summarizeSession({
      messages: [
        { role: "assistant", model: "model-a", provider: "provider-a", reasoning_effort: "low" },
        { role: "assistant", model: "model-b", provider: "provider-b", reasoning_effort: "high" },
      ],
    }, "configured-model");
    expect(metrics.configuredModel).toBe("configured-model");
    expect(metrics.observedModel).toEqual({ status: "mixed", values: ["model-a", "model-b"] });
    expect(metrics.observedProvider).toEqual({ status: "mixed", values: ["provider-a", "provider-b"] });
    expect(metrics.observedReasoningEffort).toEqual({ status: "mixed", values: ["high", "low"] });
  });

  test("preserves cost and context snapshots as separate measures", () => {
    const metrics = summarizeSession({
      meta: { prompt_tokens: 1200, completion_tokens: 50, total_tokens: 1300, cost: 0.42 },
      messages: [
        { role: "user", created: "2026-10-01T10:00:00Z" },
        { role: "assistant", created: "2026-10-01T10:00:05Z", model: "model-a", parts: [{ type: "tool_call", name: "view" }] },
        { role: "assistant", created: "2026-10-01T10:02:05Z", model: "model-a", parts: [{ type: "tool_call", name: "agent" }] },
      ],
    });
    expect(metrics).toMatchObject({
      observedModel: { status: "known", value: "model-a" },
      assistantMessages: 2,
      toolCalls: 2,
      subagentCalls: 1,
      firstAt: "2026-10-01T10:00:00.000Z",
      lastAt: "2026-10-01T10:02:05.000Z",
      wallSeconds: 125,
      contextPromptTokens: 1200,
      lastStepCompletionTokens: 50,
      contextTotalTokens: 1300,
      recordedCost: 0.42,
    });
    expect(metrics).not.toHaveProperty("tokenSpend");
  });

  test("identity observations are normalized to explicit unknown, known, or mixed states", () => {
    expect(identityObservation([])).toEqual({ status: "unknown" });
    expect(identityObservation(["one", "one"])).toEqual({ status: "known", value: "one" });
    expect(identityObservation(["two", "one"])).toEqual({ status: "mixed", values: ["one", "two"] });
  });

  test("persists only explicitly allowlisted saved-session metadata", () => {
    const metrics = allowlistedSessionFields({
      meta: { cost: 0.2, success: true },
      messages: [{ role: "assistant", model: "model-a", text: "assistant-secret", parts: [{ type: "tool_call", payload: "tool-secret" }] } as never],
      reviewText: "review-secret",
    } as never, "configured-model");
    const persisted = JSON.stringify(metrics);
    for (const secret of ["assistant-secret", "tool-secret", "review-secret"]) expect(persisted).not.toContain(secret);
    expect(persisted).toContain("model-a");
  });
});

const gateBody = [
  "## review-gate: needs-fix",
  "head-sha: 1111111111111111111111111111111111111111",
  "review-round: 0",
  "reviewed-files: 2",
  "blocking-set: src/a.ts",
  "next-action: from-pr-review https://github.com/sample-owner/example/pull/12",
].join("\n");

describe("reviewEvents", () => {
  test("parses allowlisted gates through shared parsers and ignores non-allowlisted comments", () => {
    const events = reviewEvents("sample-owner/example", 12, [
      { author: { login: "review-bot" }, createdAt: "2026-10-01T10:05:00Z", body: gateBody },
      { author: { login: "random-user" }, createdAt: "2026-10-01T10:06:00Z", body: gateBody.replace("needs-fix", "merge-candidate") },
    ], new Set(["review-bot"]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      repo: "sample-owner/example",
      prNumber: 12,
      verdict: "needs-fix",
      headSha: "1111111111111111111111111111111111111111",
      reviewRound: 0,
      reviewedFiles: 2,
      blockingSet: ["src/a.ts"],
    });
  });
});

function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    version: 1,
    sessionId: "s",
    cwd: "/tmp/repo",
    projectDir: "/tmp/repo",
    configuredModel: "configured-a",
    firstSeenAt: "2026-10-01T10:00:00Z",
    repo: "sample-owner/example",
    branch: "issue-12",
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    capturedAt: "2026-10-01T10:03:00Z",
    prNumber: 12,
    issueNumbers: [12],
    reopenedIssueNumbers: [],
    correctivePullRequestNumbers: [],
    issueStates: { "12": "OPEN" },
    prState: "OPEN",
    prMergedAt: null,
    observedModel: { status: "known", value: "model-a" },
    observedProvider: { status: "known", value: "provider-a" },
    observedReasoningEffort: { status: "unknown" },
    assistantMessages: 1,
    toolCalls: 4,
    subagentCalls: 0,
    firstAt: "2026-10-01T10:00:00Z",
    lastAt: "2026-10-01T10:02:00Z",
    wallSeconds: 120,
    contextPromptTokens: 1000,
    lastStepCompletionTokens: 100,
    contextTotalTokens: 1100,
    recordedCost: 0.1,
    successful: true,
    skills: ["from-issue"],
    ...overrides,
  };
}

function review(overrides: Partial<ReviewEvent> = {}): ReviewEvent {
  return {
    repo: "sample-owner/example",
    prNumber: 12,
    verdict: "needs-fix",
    headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    reviewRound: 0,
    reviewedFiles: 2,
    blockingSet: ["src/a.ts"],
    blockingFindingCount: 0,
    blockingFindingsComplete: false,
    rebaseline: false,
    commentedAt: "2026-10-01T10:05:00Z",
    ...overrides,
  };
}

describe("buildTaskLifecycle", () => {
  test("keeps gate acceptance separate from actual merge state and reports outcomes", () => {
    const lifecycle = buildTaskLifecycle([
      attempt(),
      attempt({
        sessionId: "repair",
        firstSeenAt: "2026-10-01T10:10:00Z",
        firstAt: "2026-10-01T10:10:00Z",
        lastAt: "2026-10-01T10:12:00Z",
        successful: false,
        reopenedIssueNumbers: [12],
        correctivePullRequestNumbers: [14],
        recordedCost: 0.2,
      }),
      attempt({
        sessionId: "escalation",
        configuredModel: "configured-b",
        observedModel: { status: "known", value: "model-b" },
        firstSeenAt: "2026-10-01T10:20:00Z",
        firstAt: "2026-10-01T10:20:00Z",
        lastAt: "2026-10-01T10:22:00Z",
        recordedCost: 0.3,
      }),
    ], [
      review({ verdict: "needs-fix" }),
      review({ verdict: "needs-fix", commentedAt: "2026-10-01T10:15:00Z", reviewRound: 1 }),
      review({ verdict: "merge-candidate", blockingSet: [], commentedAt: "2026-10-01T10:25:00Z", reviewRound: 2 }),
    ])[0];
    expect(lifecycle.gateAccepted).toBe(true);
    expect(lifecycle.merged).toBe(false);
    expect(lifecycle.prState).toBe("OPEN");
    expect(lifecycle.unsuccessfulSessions).toBe(1);
    expect(lifecycle.repairAttempts).toBe(1);
    expect(lifecycle.escalated).toBe(true);
    expect(lifecycle.reopenedIssueNumbers).toEqual([12]);
    expect(lifecycle.correctivePullRequestNumbers).toEqual([14]);
    expect(lifecycle.totalRecordedCost).toBeCloseTo(0.6);
    expect(lifecycle.finalContextTokens).toBe(1100);
    expect(lifecycle.totalRecordedCost).not.toBe(lifecycle.finalContextTokens);
  });

  test("reports merged PRs independently of gate verdicts", () => {
    const lifecycle = buildTaskLifecycle([
      attempt({ prState: "MERGED", prMergedAt: "2026-10-01T11:00:00Z" }),
    ], [])[0];
    expect(lifecycle.gateAccepted).toBe(false);
    expect(lifecycle.merged).toBe(true);
    expect(lifecycle.prMergedAt).toBe("2026-10-01T11:00:00Z");
  });

  test("keeps same-file later PRs unlinked unless explicitly identified as corrective", () => {
    expect(parseCorrectivePullRequestReferences("Updated the same paths in pull/99.")).toEqual([]);
    expect(parseCorrectivePullRequestReferences("Corrective-PR: #19\nCorrective-PR: https://github.com/sample-owner/example/pull/20")).toEqual([19, 20]);
  });
});

const allowance: AllowanceObservation = {
  version: 1,
  observedAt: "2026-10-01T12:00:00Z",
  value: 75,
  unit: "percent",
  periodStart: "2026-10-01T00:00:00Z",
  periodEnd: "2026-11-01T00:00:00Z",
  resetBoundaryAt: "2026-11-01T00:00:00Z",
  batchId: "batch-1",
  contaminated: true,
  attribution: "unattributable",
};

describe("allowance observations", () => {
  test("requires period, reset boundary and batch while retaining unattributable contamination", () => {
    expect(validateAllowanceObservation(allowance)).toEqual(allowance);
    expect(validateAllowanceObservation(allowance).attribution).toBe("unattributable");
    expect(validateAllowanceObservation(allowance).contaminated).toBe(true);
    expect(attributableAllowanceObservations([allowance])).toEqual([]);
    expect(() => validateAllowanceObservation({ ...allowance, batchId: "" })).toThrow();
  });
});

describe("persistence", () => {
  test("sync produces stable metadata-only ledgers on repeat runs", () => {
    const root = mkdtempSync(join(tmpdir(), "model-telemetry-test-"));
    const repository = mkdtempSync(join(tmpdir(), "model-telemetry-repo-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    const previousPath = process.env.PATH;
    const previousRoot = process.env.TRACER_MODEL_TELEMETRY_ROOT;
    const previousReviewers = process.env.TRACER_REVIEWER_LOGINS;
    try {
      execFileSync("git", ["init", "--quiet", repository]);
      execFileSync("git", ["-C", repository, "remote", "add", "origin", "https://github.com/example/repo.git"]);
      const ghPath = join(bin, "gh");
      const crushPath = join(bin, "crush");
      writeFileSync(ghPath, `#!/bin/sh\nprintf '%s\\n' '[{"number":12,"state":"OPEN","mergedAt":null,"headRefOid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","headRefName":"main","body":"Corrective-PR: #14","closingIssuesReferences":[],"comments":[{"author":{"login":"reviewer"},"body":"review-secret","createdAt":"2026-10-01T10:05:00Z"}]}]'\n`);
      writeFileSync(crushPath, `#!/bin/sh\nprintf '%s\\n' '{"meta":{"cost":0.2},"messages":[{"role":"user","text":"assistant-secret"},{"role":"assistant","model":"model-a","created":"2026-10-01T10:00:00Z","parts":[{"type":"tool_call","name":"bash","payload":"tool-secret"}]}]}'\n`);
      chmodSync(ghPath, 0o755);
      chmodSync(crushPath, 0o755);
      const environment = {
        ...process.env,
        PATH: `${bin}:${previousPath ?? ""}`,
        TRACER_MODEL_TELEMETRY_ROOT: root,
        TRACER_REVIEWER_LOGINS: "reviewer",
        CRUSH_SESSION_ID: "session-1",
        CRUSH_CWD: repository,
      };
      execFileSync("bun", [telemetryCli, "mark"], { cwd: repository, env: environment });
      execFileSync("bun", [telemetryCli, "allowance", "add", "--observed-at", "2026-10-01T12:00:00Z", "--value", "75", "--unit", "percent", "--period-start", "2026-10-01T00:00:00Z", "--period-end", "2026-11-01T00:00:00Z", "--reset-boundary", "2026-11-01T00:00:00Z", "--batch", "batch-1", "--contaminated"], { cwd: repository, env: environment });
      execFileSync("bun", [telemetryCli, "sync"], { cwd: repository, env: environment });
      const firstAttempts = readFileSync(join(root, "attempts.jsonl"), "utf8");
      const firstReviews = readFileSync(join(root, "reviews.jsonl"), "utf8");
      const firstAllowance = readFileSync(join(root, "allowance-observations.jsonl"), "utf8");
      execFileSync("bun", [telemetryCli, "sync"], { cwd: repository, env: environment });
      expect(readFileSync(join(root, "attempts.jsonl"), "utf8")).toBe(firstAttempts);
      expect(readFileSync(join(root, "reviews.jsonl"), "utf8")).toBe(firstReviews);
      expect(readFileSync(join(root, "allowance-observations.jsonl"), "utf8")).toBe(firstAllowance);
      for (const name of ["attempts.jsonl", "reviews.jsonl", "sessions/session-1.json"]) {
        const persisted = readFileSync(join(root, name), "utf8");
        for (const secret of ["assistant-secret", "tool-secret", "review-secret"]) expect(persisted).not.toContain(secret);
      }
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRoot === undefined) delete process.env.TRACER_MODEL_TELEMETRY_ROOT;
      else process.env.TRACER_MODEL_TELEMETRY_ROOT = previousRoot;
      if (previousReviewers === undefined) delete process.env.TRACER_REVIEWER_LOGINS;
      else process.env.TRACER_REVIEWER_LOGINS = previousReviewers;
      rmSync(root, { recursive: true, force: true });
      rmSync(repository, { recursive: true, force: true });
    }
  });

  test("mark is idempotent", () => {
    const root = mkdtempSync(join(tmpdir(), "model-telemetry-test-"));
    const repository = mkdtempSync(join(tmpdir(), "model-telemetry-repo-"));
    try {
      execFileSync("git", ["init", "--quiet", repository]);
      execFileSync("git", ["-C", repository, "remote", "add", "origin", "https://github.com/example/repo.git"]);
      const environment = {
        ...process.env,
        TRACER_MODEL_TELEMETRY_ROOT: root,
        TRACER_REVIEWER_LOGINS: "",
        CRUSH_SESSION_ID: "session-1",
        CRUSH_CWD: repository,
      };
      execFileSync("bun", [telemetryCli, "mark"], { cwd: repository, env: environment });
      const markerPath = join(root, "sessions", "session-1.json");
      const firstMarker = readFileSync(markerPath, "utf8");
      execFileSync("bun", [telemetryCli, "mark", "--cwd", "/missing"], { cwd: repository, env: environment });
      expect(readdirSync(join(root, "sessions"))).toEqual(["session-1.json"]);
      expect(readFileSync(markerPath, "utf8")).toBe(firstMarker);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(repository, { recursive: true, force: true });
    }
  });
});

describe("median", () => {
  test("returns null for empty and midpoint for odd/even samples", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
