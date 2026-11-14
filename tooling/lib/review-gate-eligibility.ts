import { parseGateComment, type Comment, type GateComment, type Verdict } from "./verdict";

const MAX_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const STALE_IN_PROGRESS_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_CORRECTIVE_ROUNDS = 2;

const VERDICT_LABELS: Record<Verdict, string> = {
  "merge-candidate": "gate:merge-candidate",
  "needs-fix": "gate:needs-fix",
  "needs-human": "gate:needs-human",
  blocked: "gate:blocked",
};

export type AttemptState = {
  headSha: string;
  status: "in-progress" | "completed" | "failed" | "escalated";
  attempts: number;
  lastAttemptAt: number;
  nextRetryAt: number | null;
};

export type EligibilityInput = {
  pullRequestNumber: number;
  currentHeadSha: string;
  currentLabels: readonly string[];
  comments: Comment[];
  trustedReviewerLogins: readonly string[];
  priorAttempt: AttemptState | null;
  now: number;
  staleInProgressTimeoutMs?: number;
};

export type EligibilityDecision =
  | { kind: "dispatch"; verdict: GateComment; attempt: AttemptState }
  | { kind: "notify-only"; verdict: GateComment; nextAction: string }
  | { kind: "stop"; reason: string; verdict?: GateComment };

export type CompletionInput = {
  exitCode: number;
  verifiedPrProgress: boolean;
  durableDispositionRecorded: boolean;
};

export type CompletionDecision =
  | { kind: "completed" }
  | { kind: "failed"; reason: "worker-failed" | "no-progress" };

function retryDelayMs(attempts: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_DELAY_MS);
}

function freshAttempt(headSha: string, now: number): AttemptState {
  return { headSha, status: "in-progress", attempts: 1, lastAttemptAt: now, nextRetryAt: null };
}

function recordFailedAttempt(previous: AttemptState, now: number, terminal = false): AttemptState {
  const exhausted = previous.attempts >= MAX_ATTEMPTS;
  const status = terminal || exhausted ? "escalated" : "failed";
  return {
    ...previous,
    status,
    nextRetryAt: status === "failed" ? now + retryDelayMs(previous.attempts) : null,
  };
}

function nextAttempt(previous: AttemptState, headSha: string, now: number): AttemptState {
  if (previous.headSha !== headSha) return freshAttempt(headSha, now);
  return {
    headSha,
    status: "in-progress",
    attempts: previous.attempts + 1,
    lastAttemptAt: now,
    nextRetryAt: null,
  };
}

function attemptDecision(input: EligibilityInput, verdict: GateComment): EligibilityDecision {
  const existing = input.priorAttempt;
  if (!existing || existing.headSha !== input.currentHeadSha) {
    return { kind: "dispatch", verdict, attempt: freshAttempt(input.currentHeadSha, input.now) };
  }
  if (existing.status === "completed") return { kind: "stop", reason: "already-completed", verdict };
  if (existing.status === "escalated" || existing.attempts >= MAX_ATTEMPTS) {
    return { kind: "stop", reason: "attempt-limit", verdict };
  }
  if (existing.status === "failed") {
    if (input.now < (existing.nextRetryAt ?? 0)) return { kind: "stop", reason: "retry-not-due", verdict };
    return { kind: "dispatch", verdict, attempt: nextAttempt(existing, input.currentHeadSha, input.now) };
  }
  if (input.now < existing.lastAttemptAt + (input.staleInProgressTimeoutMs ?? STALE_IN_PROGRESS_TIMEOUT_MS)) {
    return { kind: "stop", reason: "attempt-in-progress", verdict };
  }
  return { kind: "dispatch", verdict, attempt: nextAttempt(existing, input.currentHeadSha, input.now) };
}

function validAllowlist(logins: readonly string[]): boolean {
  return logins.some((login) => login.trim().length > 0);
}

function currentVerdictLabel(labels: readonly string[]): string | null {
  const present = Object.values(VERDICT_LABELS).filter((label) => labels.includes(label));
  return present.length === 1 ? present[0] : null;
}

function stop(reason: string, verdict?: GateComment): EligibilityDecision {
  return verdict ? { kind: "stop", reason, verdict } : { kind: "stop", reason };
}

function evaluateReviewGateEligibility(input: EligibilityInput): EligibilityDecision {
  if (!validAllowlist(input.trustedReviewerLogins)) return stop("missing-allowlist");

  let untrustedCommentSeen = false;
  const untrustedComments: string[] = [];
  const parsed = parseGateComment(input.comments, {
    pullRequestNumber: input.pullRequestNumber,
    trustedReviewerLogins: input.trustedReviewerLogins,
  }, (login) => { untrustedComments.push(login); });
  untrustedCommentSeen = untrustedComments.length > 0;
  if (parsed.kind === "none") return stop(untrustedCommentSeen ? "untrusted-comment" : "no-verdict");
  if (parsed.kind === "invalid") return stop("malformed-verdict");

  const verdict = parsed.verdict;
  if (verdict.headSha !== input.currentHeadSha) return stop("stale-verdict", verdict);
  if (currentVerdictLabel(input.currentLabels) !== VERDICT_LABELS[verdict.verdict]) {
    return stop("verdict-label-mismatch", verdict);
  }
  if (verdict.verdict === "needs-human") {
    return verdict.nextAction
      ? { kind: "notify-only", verdict, nextAction: verdict.nextAction }
      : stop("missing-next-action", verdict);
  }
  if (verdict.verdict !== "needs-fix") return stop("non-actionable-verdict", verdict);
  if (verdict.reviewRound > MAX_CORRECTIVE_ROUNDS) return stop("circuit-breaker", verdict);
  return attemptDecision(input, verdict);
}

function hasNewDurableDisposition(before: readonly Comment[], after: readonly Comment[]): boolean {
  const prior = new Set(before.map((comment) => `${comment.createdAt}\u0000${comment.author?.login ?? ""}\u0000${comment.body}`));
  return after.some((comment) => {
    const key = `${comment.createdAt}\u0000${comment.author?.login ?? ""}\u0000${comment.body}`;
    return !prior.has(key) && comment.body.includes("Disposition ledger:") && comment.body.includes("Next action:") &&
      /(?:disposition: (?:fix-now|follow-up-issue|defer|reject|needs-human))/.test(comment.body);
  });
}

function evaluateFixPassCompletion(input: CompletionInput): CompletionDecision {
  if (input.exitCode !== 0) return { kind: "failed", reason: "worker-failed" };
  if (!input.verifiedPrProgress && !input.durableDispositionRecorded) {
    return { kind: "failed", reason: "no-progress" };
  }
  return { kind: "completed" };
}

export { evaluateFixPassCompletion, evaluateReviewGateEligibility, hasNewDurableDisposition, recordFailedAttempt, retryDelayMs };
