#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  buildTaskLifecycle,
  median,
  normalizeGitHubRemote,
  reviewEvents,
  summarizeSession,
  type AttemptRecord,
  type CrushSession,
  type ReviewEvent,
  type SessionMarker,
} from "./lib";

const ROOT =
  process.env.TRACER_MODEL_TELEMETRY_ROOT ??
  join(homedir(), ".local/state/tracer/model-telemetry");
const MARKERS_DIR = join(ROOT, "sessions");
const ATTEMPTS_PATH = join(ROOT, "attempts.jsonl");
const REVIEWS_PATH = join(ROOT, "reviews.jsonl");

function arg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function safeExec(command: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function gitContext(cwd: string): Pick<SessionMarker, "repo" | "branch" | "headSha"> {
  const root = safeExec("git", ["rev-parse", "--show-toplevel"], cwd);
  if (!root) return { repo: null, branch: null, headSha: null };
  const remote = safeExec("git", ["remote", "get-url", "origin"], root);
  return {
    repo: normalizeGitHubRemote(remote),
    branch: safeExec("git", ["branch", "--show-current"], root),
    headSha: safeExec("git", ["rev-parse", "HEAD"], root),
  };
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

function writeJsonl<T>(path: string, rows: T[]): void {
  atomicWrite(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function mark(args: string[]): void {
  const sessionId = arg(args, "--session") ?? process.env.CRUSH_SESSION_ID;
  const cwd = resolve(arg(args, "--cwd") ?? process.env.CRUSH_CWD ?? process.cwd());
  const projectDir = arg(args, "--project-dir") ?? process.env.CRUSH_PROJECT_DIR ?? null;
  if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return;

  mkdirSync(MARKERS_DIR, { recursive: true });
  const markerPath = join(MARKERS_DIR, `${sessionId}.json`);
  if (existsSync(markerPath)) return;

  const git = gitContext(cwd);
  const marker: SessionMarker = {
    version: 1,
    sessionId,
    cwd,
    projectDir,
    firstSeenAt: new Date().toISOString(),
    ...git,
  };
  atomicWrite(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
}

type PRInfo = {
  number: number;
  state: string;
  mergedAt: string | null;
  headRefOid: string;
  headRefName: string;
  closingIssuesReferences?: Array<{ number?: number }>;
  comments?: Array<{
    author?: { login?: string | null } | null;
    body?: string;
    createdAt?: string;
  }>;
};

function reviewerAllowlist(): Set<string> {
  return new Set(
    (process.env.TRACER_REVIEWER_LOGINS ?? "")
      .split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );
}

function findPr(marker: SessionMarker): PRInfo | null {
  if (!marker.repo || !marker.branch) return null;
  const out = safeExec(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      marker.repo,
      "--state",
      "all",
      "--head",
      marker.branch,
      "--limit",
      "20",
      "--json",
      "number,state,mergedAt,headRefOid,headRefName,closingIssuesReferences,comments",
    ],
    marker.cwd,
  );
  if (!out) return null;
  const prs = JSON.parse(out) as PRInfo[];
  if (!prs.length) return null;
  const exact = marker.headSha ? prs.find((pr) => pr.headRefOid === marker.headSha) : null;
  return exact ?? [...prs].sort((a, b) => b.number - a.number)[0];
}

function sync(): { attempts: AttemptRecord[]; reviews: ReviewEvent[] } {
  mkdirSync(MARKERS_DIR, { recursive: true });
  const previousAttempts = new Map(
    readJsonl<AttemptRecord>(ATTEMPTS_PATH).map((record) => [record.sessionId, record]),
  );
  const previousReviews = readJsonl<ReviewEvent>(REVIEWS_PATH);
  const markers = readdirSync(MARKERS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(MARKERS_DIR, name), "utf8")) as SessionMarker);

  const allowlist = reviewerAllowlist();
  const attempts: AttemptRecord[] = [];
  const reviewsByPr = new Map<string, ReviewEvent[]>();
  for (const review of previousReviews) {
    const key = `${review.repo}#${review.prNumber}`;
    const list = reviewsByPr.get(key) ?? [];
    list.push(review);
    reviewsByPr.set(key, list);
  }

  for (const marker of markers) {
    const raw = safeExec(
      "crush",
      ["session", "show", marker.sessionId, "--json"],
      marker.cwd,
    );
    if (!raw) {
      const previous = previousAttempts.get(marker.sessionId);
      if (previous) attempts.push(previous);
      else process.stderr.write(`warning: could not read Crush session ${marker.sessionId} in ${marker.cwd}\n`);
      continue;
    }

    const session = JSON.parse(raw) as CrushSession;
    const metrics = summarizeSession(session);
    const pr = findPr(marker);
    const previous = previousAttempts.get(marker.sessionId);
    const issueNumbers = pr
      ? (pr.closingIssuesReferences ?? [])
          .map((issue) => issue.number)
          .filter((number): number is number => typeof number === "number")
          .sort((a, b) => a - b)
      : previous?.issueNumbers ?? [];

    attempts.push({
      ...marker,
      ...metrics,
      capturedAt: new Date().toISOString(),
      prNumber: pr?.number ?? previous?.prNumber ?? null,
      issueNumbers,
      prState: pr?.state ?? previous?.prState ?? null,
      prMergedAt: pr?.mergedAt ?? previous?.prMergedAt ?? null,
    });

    if (marker.repo && pr && allowlist.size > 0) {
      const key = `${marker.repo}#${pr.number}`;
      reviewsByPr.set(
        key,
        reviewEvents(marker.repo, pr.number, pr.comments ?? [], allowlist),
      );
    }
  }

  if (allowlist.size === 0) {
    process.stderr.write(
      "warning: TRACER_REVIEWER_LOGINS is empty; preserving prior review telemetry and syncing attempts only\n",
    );
  }

  attempts.sort((a, b) =>
    (a.firstAt ?? a.firstSeenAt).localeCompare(b.firstAt ?? b.firstSeenAt),
  );
  const reviews = [...reviewsByPr.values()]
    .flat()
    .sort((a, b) => a.commentedAt.localeCompare(b.commentedAt));

  writeJsonl(ATTEMPTS_PATH, attempts);
  writeJsonl(REVIEWS_PATH, reviews);

  process.stdout.write(
    `Synced ${attempts.length} attempt(s), ${reviews.length} Review Gate event(s).\n`,
  );
  return { attempts, reviews };
}

function seconds(value: number | null): string {
  if (value === null) return "-";
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  return `${minutes}m${String(value % 60).padStart(2, "0")}s`;
}

function number(value: number | null): string {
  return value === null ? "-" : Math.round(value).toLocaleString("en-US");
}

function money(value: number | null): string {
  return value === null ? "-" : `$${value.toFixed(3)}`;
}

function report(args: string[]): void {
  const shouldSync = !args.includes("--no-sync");
  const data = shouldSync
    ? sync()
    : {
        attempts: readJsonl<AttemptRecord>(ATTEMPTS_PATH),
        reviews: readJsonl<ReviewEvent>(REVIEWS_PATH),
      };
  const lifecycles = buildTaskLifecycle(data.attempts, data.reviews);

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(lifecycles, null, 2)}\n`);
    return;
  }

  const initialLuna = lifecycles.filter(
    (task) => task.attempts[0]?.models.some((model) => model.toLowerCase().includes("luna")),
  );
  const initialLunaNeedsFix = initialLuna.filter(
    (task) => task.attempts[0]?.review?.verdict === "needs-fix",
  );
  const escalated = lifecycles.filter((task) => task.escalatedToSol);
  const accepted = lifecycles.filter((task) => task.accepted);
  const firstPass = initialLuna.filter((task) => task.firstPassLunaAccepted);
  const repairSuccess = initialLunaNeedsFix.filter((task) => task.lunaRepairSucceeded);
  const solSuccess = escalated.filter((task) => task.solEscalationSucceeded);

  process.stdout.write("Production model telemetry\n\n");
  process.stdout.write(`PR lifecycles observed:       ${lifecycles.length}\n`);
  process.stdout.write(`Accepted by Review Gate:     ${accepted.length}\n`);
  process.stdout.write(
    `Luna first-pass accepted:    ${firstPass.length}/${initialLuna.length || 0}\n`,
  );
  process.stdout.write(
    `Luna repair success:         ${repairSuccess.length}/${initialLunaNeedsFix.length || 0}\n`,
  );
  process.stdout.write(
    `Escalated to Sol:            ${escalated.length}/${initialLuna.length || 0}\n`,
  );
  process.stdout.write(
    `Sol resolved escalations:    ${solSuccess.length}/${escalated.length || 0}\n`,
  );
  process.stdout.write(
    `Median final context size:   ${number(median(accepted.map((task) => task.finalContextTokens)))} tokens\n`,
  );
  process.stdout.write(
    `Median accepted wall time:   ${seconds(median(accepted.map((task) => task.wallSeconds)))}\n`,
  );
  process.stdout.write(
    `Median accepted model cost:  ${money(median(accepted.map((task) => task.cost)))}\n`,
  );
  process.stdout.write(
    `Median review rounds:        ${number(median(accepted.map((task) => task.reviewRounds)))}\n`,
  );

  if (!lifecycles.length) return;
  process.stdout.write("\nrepo#pr                                      route                  verdict         attempts rounds final_ctx   wall      cost\n");
  for (const task of lifecycles) {
    const route = task.attempts.map((attempt) => {
      const model = attempt.models.join(" ").toLowerCase();
      const family = model.includes("luna") ? "L" : model.includes("sol") ? "S" : "?";
      return `${family}:${attempt.phase[0]}`;
    }).join("→");
    const verdict = task.accepted
      ? "accepted"
      : task.reviews.at(-1)?.verdict ?? "unreviewed";
    process.stdout.write(
      `${(`${task.repo}#${task.prNumber}`).padEnd(44)} ${route.padEnd(22)} ${verdict.padEnd(15)} ` +
      `${String(task.attempts.length).padEnd(8)} ${String(task.reviewRounds).padEnd(6)} ` +
      `${number(task.finalContextTokens).padEnd(11)} ${seconds(task.wallSeconds).padEnd(9)} ${money(task.cost)}\n`,
    );
  }

  const blockingCounts = new Map<string, number>();
  for (const review of data.reviews) {
    if (review.verdict !== "needs-fix") continue;
    for (const path of review.blockingSet) {
      blockingCounts.set(path, (blockingCounts.get(path) ?? 0) + 1);
    }
  }
  const topBlocking = [...blockingCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topBlocking.length) {
    process.stdout.write("\nMost frequent blocking paths\n");
    for (const [path, count] of topBlocking) process.stdout.write(`  ${String(count).padStart(3)}  ${path}\n`);
  }
}

function help(): never {
  process.stderr.write(
    [
      "usage:",
      "  model-telemetry.ts mark [--session ID] [--cwd PATH]",
      "  model-telemetry.ts sync",
      "  model-telemetry.ts report [--no-sync] [--json]",
      "",
      `state root: ${ROOT}`,
      "",
    ].join("\n"),
  );
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);
if (command === "mark") mark(args);
else if (command === "sync") sync();
else if (command === "report") report(args);
else help();
