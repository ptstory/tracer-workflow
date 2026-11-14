import { describe, expect, test } from "bun:test";

import type { Comment, Verdict } from "./verdict";
import {
  evaluateFixPassCompletion,
  evaluateReviewGateEligibility,
  hasNewDurableDisposition,
  recordFailedAttempt,
  retryDelayMs,
  type AttemptState,
  type EligibilityInput,
} from "./review-gate-eligibility";

const headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const now = 3_000_000;
const pullRequestNumber = 98;
const trustedReviewerLogins = ["review-bot"];

function makeComment(verdict: Verdict, sha = headSha, round = 0): Comment {
  const blockingSet = verdict === "needs-fix" ? "src/api.ts" : "";
  const nextAction = verdict === "needs-fix"
    ? `from-pr-review https://github.com/acme/repo/pull/${pullRequestNumber}`
    : verdict === "merge-candidate"
      ? `gh pr merge ${pullRequestNumber} --squash --match-head-commit ${sha}`
      : verdict === "needs-human"
        ? `gh pr view ${pullRequestNumber} --web`
        : `gh pr checks ${pullRequestNumber}`;
  return {
    author: { login: "review-bot" },
    body: `## review-gate: ${verdict}\nhead-sha: ${sha}\nreview-round: ${round}\nreviewed-files: 1\nblocking-set: ${blockingSet}\nnext-action: ${nextAction}\n`,
    createdAt: "2026-09-27T00:00:00Z",
  };
}

function input(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    pullRequestNumber,
    currentHeadSha: headSha,
    currentLabels: ["gate:needs-fix"],
    comments: [makeComment("needs-fix")],
    trustedReviewerLogins,
    priorAttempt: null,
    now,
    ...overrides,
  };
}

describe("evaluateReviewGateEligibility", () => {
  test("dispatches a current trusted needs-fix verdict once for the PR head", () => {
    expect(evaluateReviewGateEligibility(input())).toEqual({
      kind: "dispatch",
      verdict: expect.objectContaining({ verdict: "needs-fix", headSha }),
      attempt: { headSha, status: "in-progress", attempts: 1, lastAttemptAt: now, nextRetryAt: null },
    });
  });

  test("fails closed when the allowlist is missing or empty", () => {
    expect(evaluateReviewGateEligibility(input({ trustedReviewerLogins: [] }))).toEqual({
      kind: "stop",
      reason: "missing-allowlist",
    });
    expect(evaluateReviewGateEligibility(input({ trustedReviewerLogins: [" "] }))).toEqual({
      kind: "stop",
      reason: "missing-allowlist",
    });
  });

  test("ignores untrusted comments while allowing a trusted current verdict", () => {
    const trusted = makeComment("needs-fix");
    const untrusted = { ...trusted, author: { login: "attacker" }, createdAt: "2026-09-28T00:00:00Z" };
    expect(evaluateReviewGateEligibility(input({ comments: [trusted, untrusted] })).kind).toBe("dispatch");
  });

  test("stops when only an untrusted marker comment is available", () => {
    const untrusted = { ...makeComment("needs-fix"), author: { login: "attacker" } };
    expect(evaluateReviewGateEligibility(input({ comments: [untrusted] }))).toEqual({
      kind: "stop",
      reason: "untrusted-comment",
    });
  });

  test("stops on malformed trusted verdict comments", () => {
    const malformed = { ...makeComment("needs-fix"), body: "## review-gate: needs-fix\nhead-sha: invalid\n" };
    expect(evaluateReviewGateEligibility(input({ comments: [malformed] }))).toEqual({
      kind: "stop",
      reason: "malformed-verdict",
    });
  });

  test("stops on stale verdicts and labels that do not match the current verdict", () => {
    expect(evaluateReviewGateEligibility(input({ comments: [makeComment("needs-fix", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")] }))).toMatchObject({
      kind: "stop",
      reason: "stale-verdict",
    });
    expect(evaluateReviewGateEligibility(input({ currentLabels: ["gate:merge-candidate"] }))).toMatchObject({
      kind: "stop",
      reason: "verdict-label-mismatch",
    });
    expect(evaluateReviewGateEligibility(input({ currentLabels: ["gate:needs-fix", "gate:blocked"] }))).toMatchObject({
      kind: "stop",
      reason: "verdict-label-mismatch",
    });
  });

  test("makes current needs-human notify-only with the validated next action", () => {
    const decision = evaluateReviewGateEligibility(input({
      currentLabels: ["gate:needs-human"],
      comments: [makeComment("needs-human")],
    }));
    expect(decision).toMatchObject({
      kind: "notify-only",
      nextAction: `gh pr view ${pullRequestNumber} --web`,
      verdict: { verdict: "needs-human", headSha },
    });
    expect(decision).not.toHaveProperty("merge");
  });

  test.each(["merge-candidate", "blocked"] as const)("does not dispatch %s", (verdict) => {
    expect(evaluateReviewGateEligibility(input({
      currentLabels: [verdict === "blocked" ? "gate:blocked" : "gate:merge-candidate"],
      comments: [makeComment(verdict)],
    }))).toMatchObject({ kind: "stop", reason: "non-actionable-verdict" });
  });

  test("stops needs-fix after two corrective rounds", () => {
    expect(evaluateReviewGateEligibility(input({ comments: [makeComment("needs-fix", headSha, 2)] })).kind).toBe("dispatch");
    expect(evaluateReviewGateEligibility(input({ comments: [makeComment("needs-fix", headSha, 3)] }))).toMatchObject({
      kind: "stop",
      reason: "circuit-breaker",
    });
  });

  test("keeps needs-human notify-only when the corrective-round breaker has been reached", () => {
    const decision = evaluateReviewGateEligibility(input({
      currentLabels: ["gate:needs-human"],
      comments: [makeComment("needs-human", headSha, 3)],
    }));
    expect(decision).toMatchObject({ kind: "notify-only", verdict: { reviewRound: 3 } });
  });

  test("does not dispatch a duplicate completed or still-running PR/head attempt", () => {
    const completed: AttemptState = { headSha, status: "completed", attempts: 1, lastAttemptAt: now, nextRetryAt: null };
    const active: AttemptState = { ...completed, status: "in-progress" };
    expect(evaluateReviewGateEligibility(input({ priorAttempt: completed }))).toMatchObject({ kind: "stop", reason: "already-completed" });
    expect(evaluateReviewGateEligibility(input({ priorAttempt: active }))).toMatchObject({ kind: "stop", reason: "attempt-in-progress" });
    expect(evaluateReviewGateEligibility(input({ priorAttempt: active, now: now + 300_000, staleInProgressTimeoutMs: 300_000 }))).toMatchObject({
      kind: "dispatch",
      attempt: { attempts: 2 },
    });
  });

  test("waits for retry timing, then creates one incremented attempt", () => {
    const failed: AttemptState = { headSha, status: "failed", attempts: 2, lastAttemptAt: now - 120_000, nextRetryAt: now + 1 };
    expect(evaluateReviewGateEligibility(input({ priorAttempt: failed }))).toMatchObject({ kind: "stop", reason: "retry-not-due" });
    expect(evaluateReviewGateEligibility(input({ priorAttempt: { ...failed, nextRetryAt: now } }))).toMatchObject({
      kind: "dispatch",
      attempt: { headSha, status: "in-progress", attempts: 3, lastAttemptAt: now },
    });
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });

  test("stops at the attempt limit and resets the counter for a new head", () => {
    const exhausted: AttemptState = { headSha, status: "failed", attempts: 5, lastAttemptAt: now, nextRetryAt: now };
    expect(evaluateReviewGateEligibility(input({ priorAttempt: exhausted }))).toMatchObject({ kind: "stop", reason: "attempt-limit" });
    expect(recordFailedAttempt({ ...exhausted, attempts: 5 }, now).status).toBe("escalated");
    const newHead = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    expect(evaluateReviewGateEligibility(input({
      currentHeadSha: newHead,
      comments: [makeComment("needs-fix", newHead)],
      priorAttempt: exhausted,
    }))).toMatchObject({ kind: "dispatch", attempt: { headSha: newHead, attempts: 1 } });
  });
});

describe("evaluateFixPassCompletion", () => {
  test("rejects a zero-exit worker with no verified progress or durable disposition", () => {
    expect(evaluateFixPassCompletion({ exitCode: 0, verifiedPrProgress: false, durableDispositionRecorded: false })).toEqual({
      kind: "failed",
      reason: "no-progress",
    });
  });

  test("records backoff after failure and escalates when the attempt limit is reached", () => {
    const active: AttemptState = { headSha, status: "in-progress", attempts: 2, lastAttemptAt: now, nextRetryAt: null };
    expect(recordFailedAttempt(active, now)).toEqual({
      headSha,
      status: "failed",
      attempts: 2,
      lastAttemptAt: now,
      nextRetryAt: now + 120_000,
    });
    expect(recordFailedAttempt({ ...active, attempts: 5 }, now)).toMatchObject({ status: "escalated", nextRetryAt: null });
  });

  test("accepts verified PR progress or a durable disposition", () => {
    expect(evaluateFixPassCompletion({ exitCode: 0, verifiedPrProgress: true, durableDispositionRecorded: false })).toEqual({ kind: "completed" });
    expect(evaluateFixPassCompletion({ exitCode: 0, verifiedPrProgress: false, durableDispositionRecorded: true })).toEqual({ kind: "completed" });
  });

  test("requires a new structured durable disposition", () => {
    const previous: Comment[] = [];
    const next: Comment[] = [{
      author: { login: "agent" },
      createdAt: "2026-09-28T00:00:00Z",
      body: "Disposition ledger:\nthread 1 | src/api.ts | finding: example | severity: medium | disposition: defer | reasoning: out of scope | left open: tracked\nNext action: review-gate https://github.com/acme/repo/pull/98",
    }];
    expect(hasNewDurableDisposition(previous, next)).toBe(true);
    expect(hasNewDurableDisposition(next, next)).toBe(false);
    expect(hasNewDurableDisposition(previous, [{ ...next[0], body: "done" }])).toBe(false);
    expect(hasNewDurableDisposition(previous, [{ ...next[0], body: next[0].body.replace("disposition: defer", "disposition: maybe") }])).toBe(false);
  });

  test("preserves worker failure regardless of progress", () => {
    expect(evaluateFixPassCompletion({ exitCode: 1, verifiedPrProgress: true, durableDispositionRecorded: true })).toEqual({
      kind: "failed",
      reason: "worker-failed",
    });
  });
});
