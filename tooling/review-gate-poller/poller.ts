#!/usr/bin/env bun
/**
 * review-gate poller
 *
 * Every run: for each open PR in the target repo, find the latest `## review-gate:`
 * comment, check its head-sha against the PR's current head, and if it's a fresh
 * `needs-fix` verdict we haven't actioned, shell `opencode run` to do the fix pass.
 *
 * Runs under launchd on an interval (see com.tracer.review-gate-poller.plist).
 * State is a small JSON file keyed by PR number -> last-actioned SHA, so we don't
 * re-trigger on the same verdict. GitHub holds the verdicts; this file only holds
 * "what did I already act on" so the poller is idempotent.
 *
 * Requires: bun, gh (authenticated), opencode on PATH.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { evaluateFixPassCompletion, evaluateReviewGateEligibility, hasNewDurableDisposition, recordFailedAttempt, type AttemptState, type BlockingFinding, type CorrectiveReview } from "../lib/review-gate-eligibility";
import { parseGateComment, parseGateReviewMetadata, reviewerLogins, type Comment, type GateComment } from "../lib/verdict";

// --- config -------------------------------------------------------------------

const REPO = process.env.RG_REPO; // e.g. "OWNER/REPO"
const STATE_PATH =
  process.env.RG_STATE_PATH ??
  `${process.env.HOME}/.local/state/review-gate/actioned.json`;

const DEFAULT_STALE_IN_PROGRESS_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_STALE_IN_PROGRESS_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_STALE_IN_PROGRESS_TIMEOUT_MS = 24 * 60 * 60 * 1000;

if (!REPO) {
  console.error("RG_REPO not set (e.g. OWNER/REPO)");
  process.exit(1);
}

const repo: string = REPO;

// --- gh helpers ---------------------------------------------------------------

function gh(args: string[]): string {
  // execFileSync (not exec) so args are passed as an argv array — no shell, no
  // injection surface from PR/comment content.
  return execFileSync("gh", args, { encoding: "utf8" });
}

type PR = { number: number; headRefOid: string };
type CompareResult = { status: string; ahead_by: number; files: { filename: string }[] };

function openPRs(): PR[] {
  const out = gh([
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--json",
    "number,headRefOid",
  ]);
  return JSON.parse(out);
}

type PRDetails = { labels: { name: string }[]; headRefOid: string };
type ReviewComment = { user: { login: string } | null; body: string; created_at: string };

function prDetails(n: number, includeComments = false): PRDetails & { comments?: Comment[] } {
  const out = gh([
    "pr",
    "view",
    String(n),
    "--repo",
    repo,
    "--json",
    includeComments ? "labels,headRefOid,comments" : "labels,headRefOid",
  ]);
  return JSON.parse(out) as PRDetails & { comments?: Comment[] };
}

function reviewThreadComments(pullRequestNumber: number): Comment[] {
  const out = gh(["api", `repos/${repo}/issues/${pullRequestNumber}/comments`, "--paginate", "--slurp"]);
  const pages = JSON.parse(out) as ReviewComment[][];
  return pages.flatMap((page) => page.map((comment) => ({
    author: comment.user ? { login: comment.user.login } : null,
    body: comment.body,
    createdAt: comment.created_at,
  })));
}

function inlineReviewComments(pullRequestNumber: number): Comment[] {
  const out = gh(["api", `repos/${repo}/pulls/${pullRequestNumber}/comments`, "--paginate", "--slurp"]);
  const pages = JSON.parse(out) as ReviewComment[][];
  return pages.flatMap((page) => page.map((comment) => ({
    author: comment.user ? { login: comment.user.login } : null,
    body: comment.body,
    createdAt: comment.created_at,
  })));
}

function compareCommits(baseSha: string, headSha: string): CompareResult {
  if (baseSha === headSha) return { status: "identical", ahead_by: 0, files: [] };
  const out = gh(["api", `repos/${repo}/compare/${baseSha}...${headSha}`, "--paginate", "--slurp"]);
  const parsed = JSON.parse(out) as Partial<CompareResult> | Partial<CompareResult>[];
  const pages = Array.isArray(parsed) ? parsed : [parsed];
  const firstPage = pages[0];
  const files = pages.flatMap((page) => page.files ?? []);
  if (!firstPage || typeof firstPage.status !== "string" || typeof firstPage.ahead_by !== "number" || files.length >= 300 ||
    files.some((file) => typeof file.filename !== "string")) {
    throw new Error(`Unable to establish complete changed-file comparison from ${baseSha} to ${headSha}`);
  }
  return { status: firstPage.status, ahead_by: firstPage.ahead_by, files };
}

function correctiveReviewHistory(comments: Comment[], pullRequestNumber: number, trustedLogins: readonly string[]): CorrectiveReview[] {
  const reviews = comments
    .filter((comment) => comment.body.startsWith("## review-gate:") && comment.author?.login &&
      trustedLogins.some((login) => login.trim().toLowerCase() === comment.author?.login.toLowerCase()))
    .map((comment) => {
      const parsed = parseGateComment([comment], { pullRequestNumber, trustedReviewerLogins: trustedLogins });
      const metadata = parseGateReviewMetadata(comment.body);
      return parsed.kind === "parsed" && metadata
        ? { commentedAt: parsed.verdict.commentedAt, headSha: parsed.verdict.headSha, blockingTargets: metadata.blockingTargets, rebaseline: metadata.rebaseline }
        : null;
    })
    .filter((review): review is NonNullable<typeof review> => review !== null)
    .sort((left, right) => left.commentedAt.localeCompare(right.commentedAt));

  const history: CorrectiveReview[] = [];
  let previousSha: string | null = null;
  let previousTargetsKnown = true;
  for (const review of reviews) {
    if (previousSha !== null && !review.rebaseline && !previousTargetsKnown) {
      throw new Error(`Cannot derive corrective-round history for PR #${pullRequestNumber}: prior verdict has no blocking set`);
    }
    if (review.blockingTargets === null && previousSha !== null) {
      throw new Error(`Cannot derive corrective-round history for PR #${pullRequestNumber}: prior verdict has no blocking set`);
    }
    const comparison = previousSha === null || review.rebaseline || previousSha === review.headSha
      ? null
      : compareCommits(previousSha, review.headSha);
    if (comparison && (comparison.status !== "ahead" || comparison.ahead_by < 1)) {
      throw new Error(`Cannot derive corrective-round history for PR #${pullRequestNumber}: non-linear history between ${previousSha} and ${review.headSha}`);
    }
    const changedFilesSincePrevious = comparison?.files.map((file) => file.filename) ?? [];
    history.push({
      blockingTargets: review.blockingTargets ?? [],
      changedFilesSincePrevious,
      rebaseline: review.rebaseline || previousSha === null,
    });
    previousSha = review.headSha;
    previousTargetsKnown = review.blockingTargets !== null;
  }
  return history;
}

function blockingFindingsForVerdict(comments: Comment[], verdict: GateComment, pullRequestNumber: number, trustedLogins: readonly string[]): BlockingFinding[] {
  const matches = comments.flatMap((comment) => {
    if (!comment.author?.login || !trustedLogins.some((login) => login.trim().toLowerCase() === comment.author?.login.toLowerCase())) return [];
    const parsed = parseGateComment([comment], { pullRequestNumber, trustedReviewerLogins: trustedLogins });
    const metadata = parseGateReviewMetadata(comment.body);
    if (parsed.kind !== "parsed" || !metadata || parsed.verdict.headSha !== verdict.headSha || parsed.verdict.verdict !== "needs-fix") return [];
    return [{ commentedAt: parsed.verdict.commentedAt, blockingFindings: metadata.blockingFindings }];
  }).sort((left, right) => left.commentedAt.localeCompare(right.commentedAt));
  return matches.at(-1)?.blockingFindings ?? [];
}

function authenticatedLogin(): string {
  return gh(["api", "user", "--jq", ".login"]).trim();
}

// --- state --------------------------------------------------------------------

type StateRecord = AttemptState & {
  createdAt: number;
  updatedAt: number;
  exitCode: number | null;
  error: string | null;
  resultingSha: string | null;
};

type State = Record<string, StateRecord>;

function parseAttempt(record: StateRecord | null): AttemptState | null {
  if (!record) return null;
  return {
    headSha: record.headSha,
    status: record.status,
    attempts: record.attempts,
    lastAttemptAt: record.lastAttemptAt,
    nextRetryAt: record.nextRetryAt,
  };
}

function nowMs(): number {
  const raw = process.env.RG_NOW_MS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function sanitizeText(value: string): string {
  const firstLine = value.split(/\r?\n/).find((line) => line.trim().length > 0) ?? value;
  return firstLine.trim().slice(0, 500);
}

function sanitizeError(error: unknown): string {
  if (error && typeof error === "object") {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string" && stderr.trim()) return sanitizeText(stderr);
    if (Buffer.isBuffer(stderr)) return sanitizeText(stderr.toString("utf8"));

    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return sanitizeText(message);
  }

  if (typeof error === "string" && error.trim()) return sanitizeText(error);

  return "unknown error";
}

function exitCodeFrom(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "number") return code;
  return null;
}

function staleInProgressTimeoutMs(): number {
  const raw = process.env.RG_STALE_IN_PROGRESS_TIMEOUT_MS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (
      Number.isFinite(parsed) &&
      parsed >= MIN_STALE_IN_PROGRESS_TIMEOUT_MS &&
      parsed <= MAX_STALE_IN_PROGRESS_TIMEOUT_MS
    ) {
      return parsed;
    }
  }
  return DEFAULT_STALE_IN_PROGRESS_TIMEOUT_MS;
}

function normalizeRecord(raw: unknown): StateRecord | null {
  if (!raw) return null;

  if (typeof raw === "string") {
    return {
      headSha: raw,
      status: "completed",
      attempts: 1,
      createdAt: 0,
      lastAttemptAt: 0,
      updatedAt: 0,
      nextRetryAt: null,
      exitCode: null,
      error: null,
      resultingSha: null,
    };
  }

  if (typeof raw !== "object") return null;

  const record = raw as Partial<StateRecord> & { status?: unknown };
  if (typeof record.headSha !== "string" || !record.headSha) return null;

  const status =
    record.status === "completed" || record.status === "failed" || record.status === "escalated"
      ? record.status
      : "in-progress";

  return {
    headSha: record.headSha,
    status,
    attempts: typeof record.attempts === "number" && record.attempts > 0 ? record.attempts : 1,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
    lastAttemptAt: typeof record.lastAttemptAt === "number" ? record.lastAttemptAt : 0,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
    nextRetryAt: typeof record.nextRetryAt === "number" ? record.nextRetryAt : null,
    exitCode: typeof record.exitCode === "number" ? record.exitCode : null,
    error: typeof record.error === "string" ? record.error : null,
    resultingSha: typeof record.resultingSha === "string" ? record.resultingSha : null,
  };
}

function loadState(): State {
  if (!existsSync(STATE_PATH)) return {};
  const raw = JSON.parse(readFileSync(STATE_PATH, "utf8")) as Record<string, unknown>;
  const state: State = {};
  let migrated = false;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") migrated = true;
    const record = normalizeRecord(value);
    if (record) state[key] = record;
  }
  if (migrated) saveState(state);
  return state;
}

function saveState(s: State): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

// --- action -------------------------------------------------------------------

function triggerFixPass(pr: PR): void {
  const prompt =
    `A review-gate verdict on PR #${pr.number} in ${REPO} is needs-fix ` +
    `for head ${pr.headRefOid}. Read the latest \`## review-gate:\` comment, ` +
    `verify its head-sha matches ${pr.headRefOid}, then run the fix pass: apply ` +
    `from-pr-review to the fix-now findings, push, and reply per thread. ` +
    `Do not merge. Follow the review-gate verdict-contract.`;

  // opencode run <prompt> — one-shot session in the repo working dir.
  // The poller persists its own state; capture the worker's output for logging.
  const out = execFileSync("opencode", ["run", prompt], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    cwd: process.env.RG_WORKDIR ?? process.cwd(),
  });
  console.log(out);
}

// --- main ---------------------------------------------------------------------

function main(): void {
  reviewerLogins();
  const state = loadState();
  const now = nowMs();

  for (const pr of openPRs()) {
    const details = prDetails(pr.number);
    const comments = reviewThreadComments(pr.number);
    const inlineComments = inlineReviewComments(pr.number);
    const existing = state[String(pr.number)];
    const previousComments = [...comments, ...inlineComments];
    let reviewHistory: CorrectiveReview[];
    try {
      reviewHistory = correctiveReviewHistory(comments, pr.number, (process.env.TRACER_REVIEWER_LOGINS ?? "").split(","));
    } catch (error) {
      console.warn(`PR #${pr.number}: unable to establish corrective-round history: ${sanitizeError(error)}`);
      continue;
    }
    const decision = evaluateReviewGateEligibility({
      pullRequestNumber: pr.number,
      currentHeadSha: pr.headRefOid,
      currentLabels: details.labels.map((label) => label.name),
      comments,
      trustedReviewerLogins: (process.env.TRACER_REVIEWER_LOGINS ?? "").split(","),
      correctiveReviewHistory: reviewHistory,
      priorAttempt: parseAttempt(existing),
      now,
      staleInProgressTimeoutMs: staleInProgressTimeoutMs(),
    });
    if (decision.kind === "notify-only") {
      console.log(`PR #${pr.number}: needs-human; notify human with next action: ${decision.nextAction}`);
      continue;
    }
    if (decision.kind === "stop") {
      if (decision.reason === "malformed-verdict") {
        console.warn(`PR #${pr.number}: review-gate comment is unparseable; skipping`);
      }
      if (decision.reason === "attempt-limit" && existing && existing.status !== "escalated") {
        state[String(pr.number)] = { ...existing, status: "escalated", updatedAt: now };
        saveState(state);
      }
      continue;
    }

    const record: StateRecord = {
      ...decision.attempt,
      createdAt: decision.attempt.attempts === 1 ? now : existing?.createdAt ?? now,
      updatedAt: now,
      exitCode: null,
      error: null,
      resultingSha: null,
    };
    const key = String(pr.number);
    state[key] = record;
    saveState(state);

    console.log(`PR #${pr.number}: needs-fix on ${pr.headRefOid}, triggering fix pass`);
    try {
      const actingLogin = authenticatedLogin();
      triggerFixPass(pr);
      const finishedAt = nowMs();
      const updatedDetails = prDetails(pr.number, true);
      const updatedComments = [
        ...(updatedDetails.comments ?? []),
        ...reviewThreadComments(pr.number),
        ...inlineReviewComments(pr.number),
      ];
      const resultingSha = updatedDetails.headRefOid;
      const progressComparison = resultingSha === decision.verdict.headSha
        ? null
        : compareCommits(decision.verdict.headSha, resultingSha);
      const verifiedPrProgress = progressComparison?.status === "ahead" && progressComparison.ahead_by > 0;
      const durableDispositionRecorded = hasNewDurableDisposition(previousComments, updatedComments, {
        repository: repo,
        pullRequestNumber: pr.number,
        authorLogin: actingLogin,
        headSha: decision.verdict.headSha,
        resultingHeadSha: resultingSha,
        changedFilesSinceHead: progressComparison?.files.map((file) => file.filename) ?? [],
        blockingFindings: blockingFindingsForVerdict(comments, decision.verdict, pr.number, (process.env.TRACER_REVIEWER_LOGINS ?? "").split(",")),
      });
      const completion = evaluateFixPassCompletion({ exitCode: 0, verifiedPrProgress, durableDispositionRecorded });
      if (completion.kind === "failed") {
        state[key] = {
          ...state[key],
          ...recordFailedAttempt(state[key], finishedAt),
          updatedAt: finishedAt,
          exitCode: 0,
          error: completion.reason,
        };
      } else {
        state[key] = {
          ...state[key],
          status: "completed",
          updatedAt: finishedAt,
          resultingSha,
        };
      }
      saveState(state);
    } catch (error) {
      const failedAt = nowMs();
      state[key] = {
        ...state[key],
        ...recordFailedAttempt(state[key], failedAt),
        updatedAt: failedAt,
        exitCode: exitCodeFrom(error),
        error: sanitizeError(error),
      };
      saveState(state);
    }
  }
}

main();
