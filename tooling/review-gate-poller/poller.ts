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
import { evaluateFixPassCompletion, evaluateReviewGateEligibility, hasNewDurableDisposition, recordFailedAttempt, type AttemptState } from "../lib/review-gate-eligibility";
import { parseGateComment, reviewerLogins } from "../lib/verdict";

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

type Comment = { author: { login: string }; body: string; createdAt: string };
type PRDetails = { comments: Comment[]; labels: { name: string }[] };

function prDetails(n: number): PRDetails {
  const out = gh([
    "pr",
    "view",
    String(n),
    "--repo",
    repo,
    "--json",
    "comments,labels",
  ]);
  return JSON.parse(out) as PRDetails;
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

function currentGitHeadSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    cwd: process.env.RG_WORKDIR ?? process.cwd(),
  }).trim();
}

// --- main ---------------------------------------------------------------------

function main(): void {
  reviewerLogins();
  const state = loadState();
  const now = nowMs();

  for (const pr of openPRs()) {
    const details = prDetails(pr.number);
    const existing = state[String(pr.number)];
    const previousComments = details.comments;
    const decision = evaluateReviewGateEligibility({
      pullRequestNumber: pr.number,
      currentHeadSha: pr.headRefOid,
      currentLabels: details.labels.map((label) => label.name),
      comments: details.comments,
      trustedReviewerLogins: (process.env.TRACER_REVIEWER_LOGINS ?? "").split(","),
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
      const initialSha = currentGitHeadSha();
      triggerFixPass(pr);
      const finishedAt = nowMs();
      const resultingSha = currentGitHeadSha();
      const updatedComments = prDetails(pr.number).comments;
      const completion = evaluateFixPassCompletion({
        exitCode: 0,
        verifiedPrProgress: resultingSha !== initialSha,
        durableDispositionRecorded: hasNewDurableDisposition(previousComments, updatedComments),
      });
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
