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
  attributableAllowanceObservations,
  allowlistedSessionFields,
  buildTaskLifecycle,
  median,
  normalizeGitHubRemote,
  parseCorrectivePullRequestReferences,
  reviewEvents,
  unsuccessfulSessionSummary,
  trustedReviewerLogins,
  validateAllowanceObservation,
  type AllowanceObservation,
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
const ALLOWANCE_PATH = join(ROOT, "allowance-observations.jsonl");

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
  if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return;

  const markerPath = join(MARKERS_DIR, `${sessionId}.json`);
  if (existsSync(markerPath)) return;

  const cwd = resolve(arg(args, "--cwd") ?? process.env.CRUSH_CWD ?? process.cwd());
  const projectDir = arg(args, "--project-dir") ?? process.env.CRUSH_PROJECT_DIR ?? null;
  mkdirSync(MARKERS_DIR, { recursive: true });
  const git = gitContext(cwd);
  const marker: SessionMarker = {
    version: 1,
    sessionId,
    cwd,
    projectDir,
    configuredModel: process.env.CRUSH_MODEL ?? null,
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
  body?: string;
  comments?: Array<{
    author?: { login?: string | null } | null;
    body?: string;
    createdAt?: string;
  }>;
};

function markerExecCwd(marker: SessionMarker): string {
  if (existsSync(marker.cwd)) return marker.cwd;
  if (marker.projectDir && existsSync(marker.projectDir)) return marker.projectDir;
  return homedir();
}

function prView(repo: string, number: number, cwd: string): PRInfo | null {
  const out = safeExec(
    "gh",
    [
      "pr",
      "view",
      String(number),
      "--repo",
      repo,
      "--json",
      "number,state,mergedAt,headRefOid,headRefName,body,closingIssuesReferences,comments",
    ],
    cwd,
  );
  return out ? (JSON.parse(out) as PRInfo) : null;
}

function findPr(marker: SessionMarker): PRInfo | null {
  if (!marker.repo) return null;
  const cwd = markerExecCwd(marker);

  if (marker.branch) {
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
        "number,state,mergedAt,headRefOid,headRefName,body,closingIssuesReferences,comments",
      ],
      cwd,
    );
    if (out) {
      const prs = JSON.parse(out) as PRInfo[];
      const exact = marker.headSha ? prs.find((pr) => pr.headRefOid === marker.headSha) : null;
      const newest = [...prs].sort((a, b) => b.number - a.number)[0];
      if (exact ?? newest) return exact ?? newest;
    }
  }

  if (!marker.headSha) return null;
  const numberRaw = safeExec(
    "gh",
    [
      "api",
      `repos/${marker.repo}/commits/${marker.headSha}/pulls`,
      "--jq",
      ".[0].number // empty",
    ],
    cwd,
  );
  const number = Number(numberRaw);
  return Number.isInteger(number) && number > 0 ? prView(marker.repo, number, cwd) : null;
}

function writeAllowanceObservation(args: string[]): void {
  const value = Number(arg(args, "--value"));
  if (!Number.isFinite(value)) throw new Error("--value must be a number");
  const observation = validateAllowanceObservation({
    version: 1,
    observedAt: arg(args, "--observed-at") ?? new Date().toISOString(),
    value,
    unit: arg(args, "--unit") ?? "",
    periodStart: arg(args, "--period-start") ?? "",
    periodEnd: arg(args, "--period-end") ?? null,
    resetBoundaryAt: arg(args, "--reset-boundary") ?? "",
    batchId: arg(args, "--batch") ?? "",
    contaminated: args.includes("--contaminated"),
    attribution: "unattributable",
  });
  mkdirSync(ROOT, { recursive: true });
  const observations = readJsonl<AllowanceObservation>(ALLOWANCE_PATH);
  observations.push(observation);
  writeJsonl(ALLOWANCE_PATH, observations);
  process.stdout.write(`Recorded one unattributable account-level allowance observation in batch ${observation.batchId}.\n`);
}

function sync(): { attempts: AttemptRecord[]; reviews: ReviewEvent[] } {
  mkdirSync(MARKERS_DIR, { recursive: true });
  const previousAttempts = new Map(
    readJsonl<AttemptRecord>(ATTEMPTS_PATH).map((record) => [record.sessionId, record]),
  );
  const previousReviews = readJsonl<ReviewEvent>(REVIEWS_PATH);
  const previousAllowanceObservations = readJsonl<AllowanceObservation>(ALLOWANCE_PATH);
  const markers = readdirSync(MARKERS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(MARKERS_DIR, name), "utf8")) as SessionMarker);

  let allowlist: Set<string>;
  try {
    allowlist = trustedReviewerLogins();
  } catch {
    allowlist = new Set();
  }
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
      markerExecCwd(marker),
    );
    if (!raw) {
      const previous = previousAttempts.get(marker.sessionId);
      if (previous) attempts.push(previous);
      else process.stderr.write(`warning: could not read Crush session ${marker.sessionId} in ${marker.cwd}\n`);
      continue;
    }

    const session = JSON.parse(raw) as CrushSession;
    const metrics = allowlistedSessionFields(session, marker.configuredModel);
    const pr = findPr(marker);
    const previous = previousAttempts.get(marker.sessionId);
    const issueNumbers = pr
      ? (pr.closingIssuesReferences ?? [])
          .map((issue) => issue.number)
          .filter((number): number is number => typeof number === "number")
          .sort((a, b) => a - b)
      : previous?.issueNumbers ?? [];

    const issueStates: Record<string, string> = {};
    if (marker.repo) {
      for (const issueNumber of issueNumbers) {
        const state = safeExec("gh", ["issue", "view", String(issueNumber), "--repo", marker.repo, "--json", "state", "--jq", ".state"], markerExecCwd(marker));
        if (state) issueStates[String(issueNumber)] = state;
      }
    }
    const reopenedIssueNumbers = issueNumbers.filter((number) =>
      previous?.issueStates?.[String(number)] === "CLOSED" && issueStates[String(number)] === "OPEN",
    );
    const correctivePullRequestNumbers = pr && marker.repo
      ? [...parseCorrectivePullRequestReferences(pr.body ?? "", marker.repo), ...(pr.comments ?? []).flatMap((comment) => parseCorrectivePullRequestReferences(comment.body ?? "", marker.repo!))]
      : previous?.correctivePullRequestNumbers ?? [];
    attempts.push({
      ...marker,
      ...metrics,
      capturedAt: marker.firstSeenAt,
      prNumber: pr?.number ?? previous?.prNumber ?? null,
      issueNumbers,
      issueStates: Object.keys(issueStates).length ? issueStates : previous?.issueStates ?? {},
      reopenedIssueNumbers: [...new Set([...(previous?.reopenedIssueNumbers ?? []), ...reopenedIssueNumbers])],
      correctivePullRequestNumbers: [...new Set(correctivePullRequestNumbers)].sort(),
      prState: pr?.state ?? previous?.prState ?? null,
      prMergedAt: pr?.mergedAt ?? previous?.prMergedAt ?? null,
    });

    if (marker.repo && pr && allowlist.size > 0) {
      const key = `${marker.repo}#${pr.number}`;
      reviewsByPr.set(key, reviewEvents(marker.repo, pr.number, pr.comments ?? [], allowlist));
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
  writeJsonl(ALLOWANCE_PATH, previousAllowanceObservations);

  process.stdout.write(
    `Synced ${attempts.length} attempt(s), ${reviews.length} Review Gate event(s).\n`,
  );
  return { attempts, reviews };
}

function number(value: number | null): string {
  return value === null ? "-" : Math.round(value).toLocaleString("en-US");
}

function money(value: number | null): string {
  return value === null ? "-" : `$${value.toFixed(3)}`;
}

export function report(args: string[]): void {
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

  const gateAccepted = lifecycles.filter((task) => task.gateAccepted);
  const merged = lifecycles.filter((task) => task.merged);
  const unsuccessful = unsuccessfulSessionSummary(data.attempts);
  const repairs = lifecycles.reduce((sum, task) => sum + task.repairAttempts, 0);
  const escalations = lifecycles.filter((task) => task.escalated).length;
  const uncertainTransitions = lifecycles.reduce((sum, task) => sum + task.attempts.filter((attempt) => attempt.phase === "uncertain").length, 0);
  const reopened = [...new Set(lifecycles.flatMap((task) => task.reopenedIssueNumbers))];
  const corrective = [...new Set(lifecycles.flatMap((task) => task.correctivePullRequestNumbers))];

  process.stdout.write("Local agent telemetry\n\n");
  process.stdout.write(`PR lifecycles observed:       ${lifecycles.length}\n`);
  process.stdout.write(`Gate accepted:               ${gateAccepted.length}\n`);
  process.stdout.write(`PRs merged:                  ${merged.length}\n`);
  process.stdout.write(`Unsuccessful sessions:       ${unsuccessful.total}\n`);
  process.stdout.write(`Unlinked unsuccessful:       ${unsuccessful.unlinked}\n`);
  process.stdout.write(`Repair attempts:             ${repairs}\n`);
  process.stdout.write(`Escalated lifecycles:        ${escalations}\n`);
  process.stdout.write(`Uncertain transitions:       ${uncertainTransitions}\n`);
  process.stdout.write(`Reopened issues:             ${reopened.length}\n`);
  process.stdout.write(`Linked corrective PRs:       ${corrective.length}\n`);
  process.stdout.write(`Median final context:        ${number(median(gateAccepted.map((task) => task.finalContextTokens).filter((value): value is number => value !== null)))} tokens\n`);
  process.stdout.write(`Median recorded model cost:  ${money(median(gateAccepted.map((task) => task.totalRecordedCost).filter((value): value is number => value !== null)))}\n`);
  process.stdout.write(`Median review rounds:        ${number(median(gateAccepted.map((task) => task.reviewRounds)))}\n`);
  const allowanceObservations = readJsonl<AllowanceObservation>(ALLOWANCE_PATH);
  const attributableObservations = attributableAllowanceObservations(allowanceObservations);
  process.stdout.write(`Account-level allowance observations: ${allowanceObservations.length}\n`);
  process.stdout.write(`Attributable allowance observations: ${attributableObservations.length}\n`);

  if (!lifecycles.length) return;
  process.stdout.write("\nrepo#pr                                      gate       merged     unsuccessful repair escalation reviews cost\n");
  for (const task of lifecycles) {
    process.stdout.write(
      `${(`${task.repo}#${task.prNumber}`).padEnd(44)} ${String(task.gateAccepted).padEnd(10)} ${String(task.merged).padEnd(10)} ` +
      `${String(task.unsuccessfulSessions).padEnd(12)} ${String(task.repairAttempts).padEnd(6)} ${String(task.escalated).padEnd(10)} ` +
      `${String(task.reviewRounds).padEnd(7)} ${money(task.totalRecordedCost)}\n`,
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
      "  model-telemetry.ts allowance add --value N --unit NAME --period-start ISO --reset-boundary ISO --batch ID [--period-end ISO] [--contaminated]",
      "",
      `state root: ${ROOT}`,
      "",
    ].join("\n"),
  );
  process.exit(2);
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "mark") mark(args);
  else if (command === "sync") sync();
  else if (command === "report") report(args);
  else if (command === "allowance" && args[0] === "add") writeAllowanceObservation(args.slice(1));
  else help();
}
