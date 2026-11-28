import {
  parseGateBody,
  parseGateReviewMetadata,
  reviewerLogins,
  type Verdict,
} from "../lib/verdict";

export type IdentityObservation =
  | { status: "known"; value: string }
  | { status: "unknown" }
  | { status: "mixed"; values: string[] };

export type SessionMarker = {
  version: 1;
  sessionId: string;
  cwd: string;
  projectDir: string | null;
  configuredModel: string | null;
  firstSeenAt: string;
  repo: string | null;
  branch: string | null;
  headSha: string | null;
};

export type CrushSession = {
  meta?: {
    cost?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    skills?: { name?: string }[];
    reasoning_effort?: string;
    success?: boolean;
  };
  messages?: Array<{
    role?: string;
    created?: string;
    model?: string;
    provider?: string;
    reasoning_effort?: string;
    parts?: Array<{ type?: string; name?: string }>;
  }>;
};

export type SessionMetrics = {
  observedModel: IdentityObservation;
  observedProvider: IdentityObservation;
  observedReasoningEffort: IdentityObservation;
  assistantMessages: number;
  toolCalls: number;
  subagentCalls: number;
  firstAt: string | null;
  lastAt: string | null;
  wallSeconds: number | null;
  contextPromptTokens: number | null;
  lastStepCompletionTokens: number | null;
  contextTotalTokens: number | null;
  recordedCost: number | null;
  successful: boolean | null;
  skills: string[];
};

export type AttemptRecord = SessionMarker &
  SessionMetrics & {
    capturedAt: string;
    prNumber: number | null;
    issueNumbers: number[];
    reopenedIssueNumbers: number[];
    correctivePullRequestNumbers: string[];
    issueStates: Record<string, string>;
    prState: string | null;
    prMergedAt: string | null;
  };

export function allowlistedSessionFields(session: CrushSession, configuredModel: string | null): SessionMetrics & { configuredModel: string | null } {
  return summarizeSession(session, configuredModel);
}

export type ReviewEvent = {
  repo: string;
  prNumber: number;
  verdict: Verdict;
  headSha: string;
  reviewRound: number;
  reviewedFiles: number;
  blockingSet: string[];
  blockingFindingCount: number;
  blockingFindingsComplete: boolean;
  rebaseline: boolean;
  commentedAt: string;
};

export type LinkedAttempt = AttemptRecord & {
  phase: "initial" | "continuation" | "repair" | "escalation" | "uncertain";
  review: ReviewEvent | null;
};

export type TaskLifecycle = {
  repo: string;
  prNumber: number;
  issueNumbers: number[];
  reopenedIssueNumbers: number[];
  correctivePullRequestNumbers: string[];
  attempts: LinkedAttempt[];
  reviews: ReviewEvent[];
  gateAccepted: boolean;
  merged: boolean;
  unsuccessfulSessions: number;
  repairAttempts: number;
  escalated: boolean;
  reviewRounds: number;
  finalContextTokens: number | null;
  wallSeconds: number;
  totalRecordedCost: number | null;
  prState: string | null;
  prMergedAt: string | null;
};

export type UnsuccessfulSessionSummary = { total: number; unlinked: number };

export type AllowanceObservation = {
  version: 1;
  observedAt: string;
  value: number;
  unit: string;
  periodStart: string;
  periodEnd: string | null;
  resetBoundaryAt: string;
  batchId: string;
  contaminated: boolean;
  attribution: "unattributable";
};

export function trustedReviewerLogins(): Set<string> {
  return reviewerLogins();
}

export function identityObservation(values: Iterable<string>): IdentityObservation {
  const observed = [...new Set([...values].filter(Boolean))].sort();
  if (observed.length === 0) return { status: "unknown" };
  if (observed.length > 1) return { status: "mixed", values: observed };
  return { status: "known", value: observed[0] };
}

export function normalizeGitHubRemote(remote: string | null | undefined): string | null {
  if (!remote) return null;
  const trimmed = remote.trim().replace(/\.git$/, "");
  const ssh = trimmed.match(/^git@github\.com:([^/]+\/[^/]+)$/);
  if (ssh) return ssh[1];
  const https = trimmed.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)$/);
  if (https) return https[1];
  const sshUrl = trimmed.match(/^ssh:\/\/git@github\.com\/([^/]+\/[^/]+)$/);
  return sshUrl ? sshUrl[1] : null;
}

export function summarizeSession(
  session: CrushSession,
  configuredModel: string | null = null,
): SessionMetrics & { configuredModel: string | null } {
  const messages = session.messages ?? [];
  const models = new Set<string>();
  const providers = new Set<string>();
  const reasoning = new Set<string>();
  let assistantMessages = 0;
  let toolCalls = 0;
  let subagentCalls = 0;
  const times: number[] = [];

  for (const message of messages) {
    if (typeof message.created === "string") {
      const parsed = Date.parse(message.created);
      if (!Number.isNaN(parsed)) times.push(parsed);
    }
    if (message.role !== "assistant") continue;
    assistantMessages++;
    if (message.model) models.add(message.model);
    if (message.provider) providers.add(message.provider);
    if (message.reasoning_effort) reasoning.add(message.reasoning_effort);
    for (const part of message.parts ?? []) {
      if (part.type !== "tool_call") continue;
      toolCalls++;
      if (part.name === "agent") subagentCalls++;
    }
  }
  if (session.meta?.reasoning_effort) reasoning.add(session.meta.reasoning_effort);
  times.sort((a, b) => a - b);

  const contextPromptTokens = typeof session.meta?.prompt_tokens === "number" ? session.meta.prompt_tokens : null;
  const lastStepCompletionTokens = typeof session.meta?.completion_tokens === "number" ? session.meta.completion_tokens : null;
  const contextTotalTokens = typeof session.meta?.total_tokens === "number"
    ? session.meta.total_tokens
    : contextPromptTokens !== null && lastStepCompletionTokens !== null
      ? contextPromptTokens + lastStepCompletionTokens
      : null;

  return {
    configuredModel,
    observedModel: identityObservation(models),
    observedProvider: identityObservation(providers),
    observedReasoningEffort: identityObservation(reasoning),
    assistantMessages,
    toolCalls,
    subagentCalls,
    firstAt: times.length ? new Date(times[0]).toISOString() : null,
    lastAt: times.length ? new Date(times[times.length - 1]).toISOString() : null,
    wallSeconds: times.length > 1 ? Math.round((times[times.length - 1] - times[0]) / 1000) : null,
    contextPromptTokens,
    lastStepCompletionTokens,
    contextTotalTokens,
    recordedCost: typeof session.meta?.cost === "number" ? session.meta.cost : null,
    successful: typeof session.meta?.success === "boolean" ? session.meta.success : null,
    skills: (session.meta?.skills ?? []).map((skill) => skill.name ?? "").filter(Boolean).sort(),
  };
}

type RawComment = {
  author?: { login?: string | null } | null;
  body?: string;
  createdAt?: string;
};

export function reviewEvents(
  repo: string,
  prNumber: number,
  comments: RawComment[],
  trustedReviewers: Set<string>,
): ReviewEvent[] {
  const events: ReviewEvent[] = [];
  for (const comment of comments) {
    const login = comment.author?.login?.toLowerCase();
    const body = comment.body ?? "";
    if (!login || !trustedReviewers.has(login) || !body.startsWith("## review-gate:")) continue;
    if (!comment.createdAt) continue;
    const parsed = parseGateBody(body, comment.createdAt, { pullRequestNumber: prNumber });
    const metadata = parseGateReviewMetadata(body);
    if (!parsed || !metadata) continue;

    events.push({
      repo,
      prNumber,
      verdict: parsed.verdict,
      headSha: parsed.headSha,
      reviewRound: parsed.reviewRound,
      reviewedFiles: parsed.reviewedFiles,
      blockingSet: metadata.blockingTargets ?? [],
      blockingFindingCount: metadata.blockingFindings.length,
      blockingFindingsComplete: metadata.blockingFindingsComplete,
      rebaseline: metadata.rebaseline,
      commentedAt: comment.createdAt,
    });
  }
  return events.sort((a, b) => a.commentedAt.localeCompare(b.commentedAt));
}

function attemptTime(attempt: AttemptRecord): string {
  return attempt.firstAt ?? attempt.firstSeenAt;
}

function attemptEnd(attempt: AttemptRecord): string {
  return attempt.lastAt ?? attempt.firstAt ?? attempt.firstSeenAt;
}

function modelTransition(previous: AttemptRecord[], current: AttemptRecord): "same" | "changed" | "unknown" {
  const prior = [...previous].reverse().find((attempt) => attempt.observedModel.status === "known");
  if (!prior || prior.observedModel.status !== "known" || current.observedModel.status !== "known") return "unknown";
  return prior.observedModel.value === current.observedModel.value ? "same" : "changed";
}

export function unsuccessfulSessionSummary(attempts: AttemptRecord[]): UnsuccessfulSessionSummary {
  const unsuccessful = attempts.filter((attempt) => attempt.successful === false);
  return {
    total: unsuccessful.length,
    unlinked: unsuccessful.filter((attempt) => !attempt.repo || attempt.prNumber === null).length,
  };
}

export function buildTaskLifecycle(
  attempts: AttemptRecord[],
  reviews: ReviewEvent[],
): TaskLifecycle[] {
  const grouped = new Map<string, AttemptRecord[]>();
  for (const attempt of attempts) {
    if (!attempt.repo || attempt.prNumber === null) continue;
    const key = `${attempt.repo}#${attempt.prNumber}`;
    const list = grouped.get(key) ?? [];
    list.push(attempt);
    grouped.set(key, list);
  }

  const lifecycles: TaskLifecycle[] = [];
  for (const [key, taskAttempts] of grouped) {
    taskAttempts.sort((a, b) => attemptTime(a).localeCompare(attemptTime(b)));
    const [repo, prText] = key.split("#");
    const prNumber = Number(prText);
    const taskReviews = reviews
      .filter((review) => review.repo === repo && review.prNumber === prNumber)
      .sort((a, b) => a.commentedAt.localeCompare(b.commentedAt));
    const linked: LinkedAttempt[] = taskAttempts.map((attempt, index) => {
      const start = attemptTime(attempt);
      const prior = taskAttempts.slice(0, index);
      const priorReview = [...taskReviews]
        .filter((candidate) => candidate.commentedAt < start)
        .at(-1) ?? null;
      let phase: LinkedAttempt["phase"];
      if (index === 0) phase = "initial";
      else if (priorReview?.verdict === "needs-fix") {
        const transition = modelTransition(prior, attempt);
        phase = transition === "changed" ? "escalation" : transition === "same" ? "repair" : "uncertain";
      } else phase = "continuation";

      const nextAttemptAt = taskAttempts[index + 1] ? attemptTime(taskAttempts[index + 1]) : null;
      const review = taskReviews.find(
        (candidate) => candidate.commentedAt >= attemptEnd(attempt) &&
          (nextAttemptAt === null || candidate.commentedAt < nextAttemptAt),
      ) ?? null;
      return { ...attempt, phase, review };
    });

    const successfulCosts = taskAttempts
      .map((attempt) => attempt.recordedCost)
      .filter((cost): cost is number => cost !== null);
    const mergedAttempt = [...taskAttempts].reverse().find((attempt) => attempt.prState !== null);
    lifecycles.push({
      repo,
      prNumber,
      issueNumbers: [...new Set(taskAttempts.flatMap((attempt) => attempt.issueNumbers))].sort((a, b) => a - b),
      reopenedIssueNumbers: [...new Set(taskAttempts.flatMap((attempt) => attempt.reopenedIssueNumbers))].sort((a, b) => a - b),
      correctivePullRequestNumbers: [...new Set(taskAttempts.flatMap((attempt) => attempt.correctivePullRequestNumbers))].sort(),
      attempts: linked,
      reviews: taskReviews,
      gateAccepted: taskReviews.some((review) => review.verdict === "merge-candidate"),
      merged: taskAttempts.some((attempt) => attempt.prMergedAt !== null),
      unsuccessfulSessions: taskAttempts.filter((attempt) => attempt.successful === false).length,
      repairAttempts: linked.filter((attempt) => attempt.phase === "repair").length,
      escalated: linked.some((attempt) => attempt.phase === "escalation"),
      reviewRounds: taskReviews.length,
      finalContextTokens: taskAttempts.at(-1)?.contextTotalTokens ?? null,
      wallSeconds: taskAttempts.reduce((sum, attempt) => sum + (attempt.wallSeconds ?? 0), 0),
      totalRecordedCost: successfulCosts.length ? successfulCosts.reduce((sum, cost) => sum + cost, 0) : null,
      prState: mergedAttempt?.prState ?? null,
      prMergedAt: taskAttempts.find((attempt) => attempt.prMergedAt !== null)?.prMergedAt ?? null,
    });
  }

  return lifecycles.sort((a, b) => a.repo.localeCompare(b.repo) || a.prNumber - b.prNumber);
}

export function parseCorrectivePullRequestReferences(body: string, repository: string): string[] {
  const references = new Set<string>();
  for (const match of body.matchAll(/^Corrective-PR:\s*(?:#(\d+)|https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+))\s*$/gim)) {
    const prNumber = Number(match[1] ?? match[3]);
    const referencedRepository = (match[2] ?? repository).toLowerCase();
    if (Number.isInteger(prNumber) && prNumber > 0 && referencedRepository === repository.toLowerCase()) {
      references.add(`${referencedRepository}#${prNumber}`);
    }
  }
  return [...references].sort((left, right) => left.localeCompare(right));
}

export function validateAllowanceObservation(observation: AllowanceObservation): AllowanceObservation {
  for (const value of [observation.observedAt, observation.periodStart, observation.resetBoundaryAt]) {
    if (!Number.isFinite(Date.parse(value))) throw new Error("allowance timestamps must be valid ISO dates");
  }
  if (observation.periodEnd !== null && !Number.isFinite(Date.parse(observation.periodEnd))) {
    throw new Error("allowance period end must be a valid ISO date");
  }
  if (!Number.isFinite(observation.value) || observation.value < 0) throw new Error("allowance value must be non-negative");
  if (!observation.unit.trim() || !observation.batchId.trim()) throw new Error("allowance unit and batch ID are required");
  return { ...observation, contaminated: observation.contaminated, attribution: "unattributable" };
}

export function attributableAllowanceObservations(observations: AllowanceObservation[]): AllowanceObservation[] {
  return observations.filter((observation) => !observation.contaminated && observation.attribution !== "unattributable");
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
