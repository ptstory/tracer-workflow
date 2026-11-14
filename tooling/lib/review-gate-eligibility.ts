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

export type CorrectiveReview = {
  blockingTargets: readonly string[];
  changedFilesSincePrevious: readonly string[];
  rebaseline: boolean;
};

export type EligibilityInput = {
  pullRequestNumber: number;
  currentHeadSha: string;
  currentLabels: readonly string[];
  comments: Comment[];
  trustedReviewerLogins: readonly string[];
  correctiveReviewHistory: readonly CorrectiveReview[];
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

export type DurableDispositionContext = {
  repository: string;
  pullRequestNumber: number;
  authorLogin: string;
  headSha: string;
  resultingHeadSha: string;
  changedFilesSinceHead: readonly string[];
  blockingTargets: readonly string[];
};

export type CompletionDecision =
  | { kind: "completed" }
  | { kind: "failed"; reason: "worker-failed" | "no-progress" };

function countCorrectiveRounds(history: readonly CorrectiveReview[]): number {
  let correctiveRounds = 0;
  let previousTargets: readonly string[] = [];
  let hasBaseline = false;

  for (const review of history) {
    if (review.rebaseline) {
      correctiveRounds = 0;
      hasBaseline = true;
    } else if (hasBaseline && review.changedFilesSincePrevious.some((file) => previousTargets.includes(file))) {
      correctiveRounds += 1;
    }
    previousTargets = review.blockingTargets;
  }

  return correctiveRounds;
}

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
  if (countCorrectiveRounds(input.correctiveReviewHistory) > MAX_CORRECTIVE_ROUNDS) return stop("circuit-breaker", verdict);
  return attemptDecision(input, verdict);
}

function hasNewDurableDisposition(
  before: readonly Comment[],
  after: readonly Comment[],
  context: DurableDispositionContext,
): boolean {
  const prior = new Set(before.map((comment) => `${comment.createdAt}\u0000${comment.author?.login ?? ""}\u0000${comment.body}`));
  const requiredTargets = new Set(context.blockingTargets);
  if (requiredTargets.size === 0) return false;

  return after.some((comment) => {
    const key = `${comment.createdAt}\u0000${comment.author?.login ?? ""}\u0000${comment.body}`;
    if (prior.has(key) || comment.author?.login.toLowerCase() !== context.authorLogin.toLowerCase() ||
      !/^[0-9a-f]{40}$/.test(context.resultingHeadSha)) return false;

    const lines = comment.body.split(/\r?\n/);
    const prLines = lines.filter((line) => /^PR: /.test(line));
    const shaLines = lines.filter((line) => /^head SHA \(before → after\): /.test(line));
    const nextActionLines = lines.filter((line) => /^Next action:/.test(line));
    const prValid = prLines.length === 1 && prLines[0] === `PR: ${context.repository}#${context.pullRequestNumber}`;
    const shaValid = shaLines.length === 1 && new RegExp(`^head SHA \\(before → after\\): ${context.headSha} → ${context.resultingHeadSha}$`).test(shaLines[0]);
    const nextActionValid = nextActionLines.length === 1 && /^Next action:\s*\S/.test(nextActionLines[0]);
    if (!prValid || !lines.includes("Disposition ledger:") || !shaValid || !nextActionValid) return false;
    const ledgerStart = lines.indexOf("Disposition ledger:");
    const nextActionIndex = lines.indexOf(nextActionLines[0]);
    const shaIndex = lines.indexOf(shaLines[0]);
    const prIndex = lines.indexOf(prLines[0]);
    const ledgerBoundary = Math.min(...[prIndex, shaIndex, nextActionIndex].filter((index) => index > ledgerStart));
    const ledgerLines = lines.slice(ledgerStart + 1, ledgerBoundary).filter((line) => line.trim());
    if (prIndex !== 0 || shaIndex <= prIndex || shaIndex >= ledgerStart || ledgerBoundary === Infinity || ledgerLines.length === 0 || ledgerLines.some((line) => !/^\s*thread [^|]+\|/.test(line))) return false;

    const ledgerRows = ledgerLines.flatMap((line) => {
      const match = line.match(/^\s*thread [^|]+\| ([^|]+) \| finding: [^|]+ \| severity: [^|]+ \| disposition: (fix-now|follow-up-issue|defer|reject|needs-human) \| reasoning: [^|]+ \| (done: ([0-9a-f]{40})|issue: #\d+|left open: .+|reply posted|handed back)\s*$/);
      return match ? [{ area: match[1].trim(), disposition: match[2], doneSha: match[3] ? match[4] : null }] : [];
    });
    if (ledgerRows.length === 0) return false;

    const dispositionsByTarget = new Map<string, Set<string>>();
    for (const row of ledgerRows) {
      for (const target of row.area.split(/,\s*/)) {
        const dispositions = dispositionsByTarget.get(target) ?? new Set<string>();
        dispositions.add(row.disposition);
        dispositionsByTarget.set(target, dispositions);
      }
    }
    return [...requiredTargets].every((target) => {
      const dispositions = dispositionsByTarget.get(target);
      if (!dispositions || dispositions.size !== 1) return false;
      const findingRows = ledgerRows.filter((row) => row.area.split(/,\s*/).includes(target));
      return findingRows.every((row) => row.disposition !== "fix-now" ||
        (row.doneSha === context.resultingHeadSha && row.doneSha !== context.headSha && context.changedFilesSinceHead.includes(target)));
    });
  });
}

function evaluateFixPassCompletion(input: CompletionInput): CompletionDecision {
  if (input.exitCode !== 0) return { kind: "failed", reason: "worker-failed" };
  if (!input.verifiedPrProgress && !input.durableDispositionRecorded) {
    return { kind: "failed", reason: "no-progress" };
  }
  return { kind: "completed" };
}

export { countCorrectiveRounds, evaluateFixPassCompletion, evaluateReviewGateEligibility, hasNewDurableDisposition, recordFailedAttempt, retryDelayMs };
