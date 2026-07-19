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

// --- config -------------------------------------------------------------------

const REPO = process.env.RG_REPO; // e.g. "ptstory/themarkergirl.com"
const STATE_PATH =
  process.env.RG_STATE_PATH ??
  `${process.env.HOME}/.local/state/review-gate/actioned.json`;

// The reviewer identity whose comments we treat as verdicts. If unset, any author's
// gate-marked comment counts — fine for a single-maintainer repo.
const REVIEWER_LOGIN = process.env.RG_REVIEWER_LOGIN;

const MAX_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const DEFAULT_STALE_IN_PROGRESS_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_STALE_IN_PROGRESS_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_STALE_IN_PROGRESS_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const GATE_MARKER = "## review-gate:";

if (!REPO) {
  console.error("RG_REPO not set (e.g. ptstory/themarkergirl.com)");
  process.exit(1);
}

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
    REPO,
    "--state",
    "open",
    "--json",
    "number,headRefOid",
  ]);
  return JSON.parse(out);
}

type Comment = { author: { login: string }; body: string; createdAt: string };

function prComments(n: number): Comment[] {
  const out = gh([
    "pr",
    "view",
    String(n),
    "--repo",
    REPO,
    "--json",
    "comments",
  ]);
  return JSON.parse(out).comments as Comment[];
}

// --- verdict parsing ----------------------------------------------------------

type Verdict = {
  state: string; // merge-candidate | needs-fix | needs-human | blocked
  headSha: string | null;
};

function parseVerdict(body: string): Verdict | null {
  if (!body.startsWith(GATE_MARKER)) return null;
  const stateMatch = body.match(/^## review-gate:\s*(\S+)/);
  const shaMatch = body.match(/^head-sha:\s*([0-9a-f]{40})\s*$/m);
  if (!stateMatch) return null;
  return {
    state: stateMatch[1].trim(),
    headSha: shaMatch ? shaMatch[1] : null, // null SHA => void, per contract
  };
}

/** Latest gate verdict on a PR, or null. Latest by comment order (chronological). */
function latestVerdict(n: number): Verdict | null {
  const comments = prComments(n);
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i];
    if (REVIEWER_LOGIN && c.author.login !== REVIEWER_LOGIN) continue;
    const v = parseVerdict(c.body);
    if (v) return v;
  }
  return null;
}

// --- state --------------------------------------------------------------------

type RecordStatus = "in-progress" | "completed" | "failed" | "escalated";

type StateRecord = {
  headSha: string;
  status: RecordStatus;
  attempts: number;
  createdAt: number;
  lastAttemptAt: number;
  updatedAt: number;
  nextRetryAt: number | null;
  exitCode: number | null;
  error: string | null;
  resultingSha: string | null;
};

type State = Record<string, StateRecord>;

function nowMs(): number {
  const raw = process.env.RG_NOW_MS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function freshRecord(headSha: string, now: number): StateRecord {
  return {
    headSha,
    status: "in-progress",
    attempts: 1,
    createdAt: now,
    lastAttemptAt: now,
    updatedAt: now,
    nextRetryAt: null,
    exitCode: null,
    error: null,
    resultingSha: null,
  };
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

function retryDelayMs(attempts: number): number {
  const delay = BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(delay, MAX_RETRY_DELAY_MS);
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
    `receiving-code-review to the fix-now findings, push, and reply per thread. ` +
    `Do not merge. Follow the review-gate verdict-contract.`;

  // opencode run <prompt> — one-shot session in the repo working dir.
  // The poller persists its own state; worker output is not streamed through.
  execFileSync("opencode", ["run", prompt], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.env.RG_WORKDIR ?? process.cwd(),
  });
}

function currentGitHeadSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    cwd: process.env.RG_WORKDIR ?? process.cwd(),
  }).trim();
}

function prepareAttempt(record: StateRecord, headSha: string, now: number): StateRecord {
  if (record.headSha !== headSha) return freshRecord(headSha, now);
  return {
    ...record,
    status: "in-progress",
    attempts: record.attempts + 1,
    lastAttemptAt: now,
    updatedAt: now,
    nextRetryAt: null,
    exitCode: null,
    error: null,
    resultingSha: null,
  };
}

function recordFailure(record: StateRecord, error: unknown, now: number): StateRecord {
  const attempts = record.attempts;
  const status: RecordStatus = attempts >= MAX_ATTEMPTS ? "escalated" : "failed";
  return {
    ...record,
    status,
    updatedAt: now,
    exitCode: exitCodeFrom(error),
    error: sanitizeError(error),
    nextRetryAt: status === "failed" ? now + retryDelayMs(attempts) : record.nextRetryAt,
  };
}

function shouldAttempt(record: StateRecord, now: number): boolean {
  if (record.status === "escalated") return false;
  if (record.status === "failed") {
    if (record.attempts >= MAX_ATTEMPTS) return false;
    return now >= (record.nextRetryAt ?? 0);
  }
  if (record.status === "in-progress") {
    return now >= record.lastAttemptAt + staleInProgressTimeoutMs();
  }
  return false;
}

// --- main ---------------------------------------------------------------------

function main(): void {
  const state = loadState();
  const now = nowMs();

  for (const pr of openPRs()) {
    const v = latestVerdict(pr.number);
    if (!v) continue;

    // SHA-staleness rule: verdict only valid on current head.
    if (v.headSha !== pr.headRefOid) continue;

    // Only needs-fix triggers autonomous action. merge-candidate/needs-human/
    // blocked surface to the human — the poller does not merge or escalate.
    if (v.state !== "needs-fix") continue;

    const key = String(pr.number);
    const existing = state[key];

    let record: StateRecord;

    if (!existing || existing.headSha !== pr.headRefOid) {
      record = freshRecord(pr.headRefOid, now);
    } else if (existing.status === "escalated") {
      continue;
    } else if (existing.status === "failed") {
      if (existing.attempts >= MAX_ATTEMPTS) {
        state[key] = { ...existing, status: "escalated", updatedAt: now };
        saveState(state);
        continue;
      }
      if (!shouldAttempt(existing, now)) continue;
      record = prepareAttempt(existing, pr.headRefOid, now);
    } else if (existing.status === "in-progress") {
      if (existing.attempts >= MAX_ATTEMPTS) {
        state[key] = { ...existing, status: "escalated", updatedAt: now };
        saveState(state);
        continue;
      }
      if (!shouldAttempt(existing, now)) continue;
      record = prepareAttempt(existing, pr.headRefOid, now);
    } else {
      continue;
    }

    state[key] = record;
    saveState(state);

    console.log(`PR #${pr.number}: needs-fix on ${pr.headRefOid}, triggering fix pass`);
    try {
      triggerFixPass(pr);
      state[key] = {
        ...state[key],
        status: "completed",
        updatedAt: nowMs(),
        resultingSha: currentGitHeadSha(),
      };
      saveState(state);
    } catch (error) {
      state[key] = recordFailure(state[key], error, nowMs());
      saveState(state);
    }
  }
}

main();
