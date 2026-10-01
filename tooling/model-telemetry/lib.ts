import { parseGateBody, type Verdict } from "../lib/verdict";

export type SessionMarker = {
  version: 1;
  sessionId: string;
  cwd: string;
  projectDir: string | null;
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
  };
  messages?: Array<{
    role?: string;
    created?: string;
    model?: string;
    reasoning_effort?: string;
    parts?: Array<{ type?: string; name?: string }>;
  }>;
};

export type SessionMetrics = {
  models: string[];
  reasoningEfforts: string[];
  assistantMessages: number;
  toolCalls: number;
  subagentCalls: number;
  firstAt: string | null;
  lastAt: string | null;
  wallSeconds: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cost: number | null;
  skills: string[];
};

export type AttemptRecord = SessionMarker &
  SessionMetrics & {
    capturedAt: string;
    prNumber: number | null;
    issueNumbers: number[];
    prState: string | null;
    prMergedAt: string | null;
  };

export type ReviewEvent = {
  repo: string;
  prNumber: number;
  verdict: Verdict;
  headSha: string;
  reviewRound: number;
  reviewedFiles: number;
  blockingSet: string[];
  fixNowCount: number;
  commentedAt: string;
};

export type LinkedAttempt = AttemptRecord & {
  phase: "initial" | "repair" | "escalation";
  review: ReviewEvent | null;
};

export type TaskLifecycle = {
  repo: string;
  prNumber: number;
  issueNumbers: number[];
  attempts: LinkedAttempt[];
  reviews: ReviewEvent[];
  accepted: boolean;
  firstPassLunaAccepted: boolean;
  lunaRepairSucceeded: boolean;
  escalatedToSol: boolean;
  solEscalationSucceeded: boolean;
  reviewRounds: number;
  totalTokens: number;
  wallSeconds: number;
  cost: number;
};

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

export function summarizeSession(session: CrushSession): SessionMetrics {
  const messages = session.messages ?? [];
  const models = new Set<string>();
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
    if (message.reasoning_effort) reasoning.add(message.reasoning_effort);
    for (const part of message.parts ?? []) {
      if (part.type !== "tool_call") continue;
      toolCalls++;
      if (part.name === "agent") subagentCalls++;
    }
  }
  if (session.meta?.reasoning_effort) reasoning.add(session.meta.reasoning_effort);
  times.sort((a, b) => a - b);

  const promptTokens = typeof session.meta?.prompt_tokens === "number" ? session.meta.prompt_tokens : null;
  const completionTokens = typeof session.meta?.completion_tokens === "number" ? session.meta.completion_tokens : null;
  const totalTokens = typeof session.meta?.total_tokens === "number"
    ? session.meta.total_tokens
    : promptTokens !== null && completionTokens !== null
      ? promptTokens + completionTokens
      : null;

  return {
    models: [...models].sort(),
    reasoningEfforts: [...reasoning].sort(),
    assistantMessages,
    toolCalls,
    subagentCalls,
    firstAt: times.length ? new Date(times[0]).toISOString() : null,
    lastAt: times.length ? new Date(times[times.length - 1]).toISOString() : null,
    wallSeconds: times.length > 1 ? Math.round((times[times.length - 1] - times[0]) / 1000) : null,
    promptTokens,
    completionTokens,
    totalTokens,
    cost: typeof session.meta?.cost === "number" ? session.meta.cost : null,
    skills: (session.meta?.skills ?? []).map((skill) => skill.name ?? "").filter(Boolean).sort(),
  };
}

type RawComment = {
  author?: { login?: string | null } | null;
  body?: string;
  createdAt?: string;
};

function integerField(body: string, name: string): number | null {
  const match = body.match(new RegExp(`^${name}:\\s*(\\d+)\\s*$`, "m"));
  return match ? Number(match[1]) : null;
}

function textField(body: string, name: string): string | null {
  const match = body.match(new RegExp(`^${name}:\\s*(.*)$`, "m"));
  return match ? match[1].trim() : null;
}

export function reviewEvents(
  repo: string,
  prNumber: number,
  comments: RawComment[],
  reviewerLogins: Set<string>,
): ReviewEvent[] {
  const events: ReviewEvent[] = [];
  for (const comment of comments) {
    const login = comment.author?.login?.toLowerCase();
    const body = comment.body ?? "";
    if (!login || !reviewerLogins.has(login) || !body.startsWith("## review-gate:")) continue;
    const parsed = parseGateBody(body);
    if (!parsed || !comment.createdAt) continue;

    const blockingRaw = textField(body, "blocking-set") ?? "";
    const blockingSet = blockingRaw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const fixNowCount =
      integerField(body, "fix-now-count") ??
      (body.match(/\[fix-now\]/g) ?? []).length;

    events.push({
      repo,
      prNumber,
      verdict: parsed.verdict,
      headSha: parsed.headSha,
      reviewRound: parsed.reviewRound,
      reviewedFiles: parsed.reviewedFiles,
      blockingSet,
      fixNowCount,
      commentedAt: comment.createdAt,
    });
  }
  return events.sort((a, b) => a.commentedAt.localeCompare(b.commentedAt));
}

function modelFamily(attempt: AttemptRecord): "luna" | "sol" | "other" {
  const models = attempt.models.join(" ").toLowerCase();
  if (models.includes("luna")) return "luna";
  if (models.includes("sol")) return "sol";
  return "other";
}

function attemptTime(attempt: AttemptRecord): string {
  return attempt.firstAt ?? attempt.firstSeenAt;
}

function attemptEnd(attempt: AttemptRecord): string {
  return attempt.lastAt ?? attempt.firstAt ?? attempt.firstSeenAt;
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
      const prior = taskAttempts.slice(0, index);
      const family = modelFamily(attempt);
      const priorLuna = prior.some((item) => modelFamily(item) === "luna");
      const priorNeedsFix = taskReviews.some(
        (review) => review.verdict === "needs-fix" && review.commentedAt <= attemptTime(attempt),
      );
      const phase: LinkedAttempt["phase"] =
        index === 0 ? "initial" : family === "sol" && priorLuna && priorNeedsFix ? "escalation" : "repair";
      const nextAttemptAt = taskAttempts[index + 1] ? attemptTime(taskAttempts[index + 1]) : null;
      const review = taskReviews.find(
        (candidate) =>
          candidate.commentedAt >= attemptEnd(attempt) &&
          (nextAttemptAt === null || candidate.commentedAt < nextAttemptAt),
      ) ?? null;
      return { ...attempt, phase, review };
    });

    const acceptedIndex = linked.findIndex((attempt) => attempt.review?.verdict === "merge-candidate");
    const accepted = acceptedIndex >= 0 || taskReviews.some((review) => review.verdict === "merge-candidate");
    const first = linked[0];
    const firstPassLunaAccepted =
      Boolean(first) && modelFamily(first) === "luna" && first.review?.verdict === "merge-candidate";
    const firstNeedsFix =
      Boolean(first) && modelFamily(first) === "luna" && first.review?.verdict === "needs-fix";
    const firstSolIndex = linked.findIndex((attempt) => attempt.phase === "escalation");
    const escalatedToSol = firstSolIndex >= 0;
    const lunaRepairSucceeded =
      firstNeedsFix &&
      linked.some(
        (attempt, index) =>
          index > 0 &&
          (firstSolIndex < 0 || index < firstSolIndex) &&
          modelFamily(attempt) === "luna" &&
          attempt.review?.verdict === "merge-candidate",
      );
    const solEscalationSucceeded =
      escalatedToSol &&
      linked.slice(firstSolIndex).some(
        (attempt) => modelFamily(attempt) === "sol" && attempt.review?.verdict === "merge-candidate",
      );

    const counted = acceptedIndex >= 0 ? linked.slice(0, acceptedIndex + 1) : linked;
    lifecycles.push({
      repo,
      prNumber,
      issueNumbers: [...new Set(taskAttempts.flatMap((attempt) => attempt.issueNumbers))].sort((a, b) => a - b),
      attempts: linked,
      reviews: taskReviews,
      accepted,
      firstPassLunaAccepted,
      lunaRepairSucceeded,
      escalatedToSol,
      solEscalationSucceeded,
      reviewRounds: taskReviews.length ? Math.max(...taskReviews.map((review) => review.reviewRound)) + 1 : 0,
      totalTokens: counted.reduce((sum, attempt) => sum + (attempt.totalTokens ?? 0), 0),
      wallSeconds: counted.reduce((sum, attempt) => sum + (attempt.wallSeconds ?? 0), 0),
      cost: counted.reduce((sum, attempt) => sum + (attempt.cost ?? 0), 0),
    });
  }

  return lifecycles.sort((a, b) => a.repo.localeCompare(b.repo) || a.prNumber - b.prNumber);
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
