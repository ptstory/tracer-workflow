#!/usr/bin/env bun

// Collects correction signals for skill discovery and writes a compact digest.
// Extraction is deterministic on purpose: the model that reads the digest only
// clusters and classifies, so a cheaper model can do the judgment step.

import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export type SignalSource =
  | "review"
  | "inline-review"
  | "thread-comment"
  | "failed-run"
  | "fix-commit"
  | "transcript";

export type Signal = {
  source: SignalSource;
  ref: string;
  at: string;
  author?: string;
  bot?: boolean;
  url?: string;
  text: string;
  context?: string;
};

export type CollapsedNotice = { author: string; firstLine: string; count: number; refs: string[] };

type PullSummary = { number: number; title: string; state: string; merged: boolean; createdAt: string };

type SourceReport = { name: string; status: string };

// High recall on purpose: the model discards false positives, but it cannot
// recover corrections this filter drops.
const CORRECTION_PATTERN =
  /\b(no|nope|don'?t|do not|stop|wrong|instead|actually|forgot|didn'?t|missed|again|revert|undo|not what|why did you|should(?:n'?t)? have|i said|i told you|already|still|incorrect|broke|broken)\b/i;

const FIX_COMMIT_PATTERN = /\b(fix|fixes|fixed|revert|hotfix|oops|typo|undo|broken|regression|again|restore)\b/i;

export function isCorrection(text: string): boolean {
  return CORRECTION_PATTERN.test(text);
}

export function isFixCommit(subject: string): boolean {
  return FIX_COMMIT_PATTERN.test(subject);
}

export function clip(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}

function noticeKey(signal: Signal): string {
  const firstLine = (signal.text.split("\n").find((line) => line.trim() !== "") ?? "").trim();
  const normalized = firstLine.toLowerCase().replace(/[0-9a-f]{7,}/g, "<sha>").replace(/\d+/g, "<n>");
  return `${signal.author ?? ""}\u0000${normalized}`;
}

// Status bots repeat the same notice on every PR; keep one line per notice shape.
export function collapseBotNotices(
  signals: Signal[],
  minRepeats = 3,
): { kept: Signal[]; collapsed: CollapsedNotice[] } {
  const groups = new Map<string, Signal[]>();

  for (const signal of signals) {
    if (!signal.bot) continue;
    const key = noticeKey(signal);
    groups.set(key, [...(groups.get(key) ?? []), signal]);
  }

  const collapsedKeys = new Set([...groups].filter(([, group]) => group.length >= minRepeats).map(([key]) => key));
  const collapsed = [...groups]
    .filter(([key]) => collapsedKeys.has(key))
    .map(([, group]) => ({
      author: group[0]!.author ?? "unknown",
      firstLine: clip(group[0]!.text.split("\n")[0] ?? "", 160),
      count: group.length,
      refs: [...new Set(group.map((signal) => signal.ref))],
    }));

  return {
    kept: signals.filter((signal) => !signal.bot || !collapsedKeys.has(noticeKey(signal))),
    collapsed,
  };
}

// --- GitHub ---------------------------------------------------------------

function resolveToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

async function githubPages<T>(
  path: string,
  token: string | undefined,
  pick: (body: unknown) => T[] = (body) => body as T[],
  keepGoing: (page: T[]) => boolean = () => true,
): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = `https://api.github.com${path}${path.includes("?") ? "&" : "?"}per_page=100`;

  while (url) {
    const response: Response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub ${response.status} for ${url}: ${clip(await response.text(), 200)}`);
    }
    const page = pick(await response.json());
    items.push(...page);
    if (!keepGoing(page)) break;
    url = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }

  return items;
}

type GitHubUser = { login: string; type: string } | null;
type GitHubComment = { body: string | null; user: GitHubUser; created_at: string; html_url: string; issue_url?: string; pull_request_url?: string };
type GitHubReview = GitHubComment & { state: string; submitted_at: string | null };
type GitHubPull = { number: number; title: string; state: string; merged_at: string | null; created_at: string };
type GitHubRun = { name: string; head_branch: string; display_title: string; created_at: string; html_url: string; pull_requests: { number: number }[] };

function isBot(user: GitHubUser): boolean {
  return !user || user.type === "Bot" || user.login.endsWith("[bot]");
}

function trailingNumber(url: string | undefined): string {
  return `#${url?.split("/").pop() ?? "?"}`;
}

async function collectGitHub(
  repo: string,
  since: string,
  maxPrs: number,
  maxChars: number,
): Promise<{ pulls: PullSummary[]; signals: Signal[] }> {
  const token = resolveToken();
  const sinceIso = `${since}T00:00:00Z`;

  const pulls = (
    await githubPages<GitHubPull>(
      `/repos/${repo}/pulls?state=all&sort=created&direction=desc`,
      token,
      undefined,
      (page) => page.every((pull) => pull.created_at >= sinceIso),
    )
  )
    .filter((pull) => pull.created_at >= sinceIso)
    .slice(0, maxPrs);

  const signals: Signal[] = [];
  const toSignal = (source: SignalSource, ref: string, comment: GitHubComment, at: string): Signal => ({
    source,
    ref,
    at,
    author: comment.user?.login ?? "ghost",
    bot: isBot(comment.user),
    url: comment.html_url,
    text: clip(comment.body ?? "", maxChars),
  });

  for (const comment of await githubPages<GitHubComment>(`/repos/${repo}/issues/comments?since=${sinceIso}`, token)) {
    if (comment.body?.trim()) signals.push(toSignal("thread-comment", trailingNumber(comment.issue_url), comment, comment.created_at));
  }

  for (const comment of await githubPages<GitHubComment>(`/repos/${repo}/pulls/comments?since=${sinceIso}`, token)) {
    if (comment.body?.trim()) signals.push(toSignal("inline-review", trailingNumber(comment.pull_request_url), comment, comment.created_at));
  }

  for (const pull of pulls) {
    for (const review of await githubPages<GitHubReview>(`/repos/${repo}/pulls/${pull.number}/reviews`, token)) {
      if (review.body?.trim() || review.state === "CHANGES_REQUESTED") {
        const signal = toSignal("review", `#${pull.number}`, review, review.submitted_at ?? pull.created_at);
        signals.push({ ...signal, text: `[${review.state}] ${signal.text}` });
      }
    }
  }

  const runs = await githubPages<GitHubRun>(
    `/repos/${repo}/actions/runs?status=failure&created=${encodeURIComponent(`>=${since}`)}`,
    token,
    (body) => (body as { workflow_runs: GitHubRun[] }).workflow_runs,
  );
  for (const run of runs) {
    const pullRef = run.pull_requests[0] ? `#${run.pull_requests[0].number}` : run.head_branch;
    signals.push({
      source: "failed-run",
      ref: pullRef,
      at: run.created_at,
      url: run.html_url,
      text: `${run.name} failed on ${run.head_branch}: ${clip(run.display_title, 120)}`,
    });
  }

  return {
    pulls: pulls.map((pull) => ({
      number: pull.number,
      title: pull.title,
      state: pull.state,
      merged: pull.merged_at !== null,
      createdAt: pull.created_at,
    })),
    signals,
  };
}

// --- Local git ------------------------------------------------------------

function collectFixCommits(localPath: string, since: string): Signal[] {
  const log = execFileSync("git", ["-C", localPath, "log", `--since=${since}`, "--date=short", "--format=%h%x09%ad%x09%s"], {
    encoding: "utf8",
  });
  return log
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([, , subject]) => isFixCommit(subject ?? ""))
    .map(([sha, date, subject]) => ({ source: "fix-commit" as const, ref: sha ?? "", at: date ?? "", text: subject ?? "" }));
}

// --- Transcripts ----------------------------------------------------------

type TranscriptTurn = { role: "user" | "assistant"; at: string; text: string; tools: string[] };

export function correctionsFromTurns(turns: TranscriptTurn[], sessionRef: string, since: string, maxChars: number): Signal[] {
  const signals: Signal[] = [];
  let lastAssistant: TranscriptTurn | undefined;

  for (const turn of turns) {
    if (turn.role === "assistant") {
      lastAssistant = turn;
      continue;
    }
    if (!lastAssistant || turn.at < since || !isCorrection(turn.text)) continue;
    const tools = lastAssistant.tools.length ? `tools=${[...new Set(lastAssistant.tools)].join(",")} ` : "";
    signals.push({
      source: "transcript",
      ref: sessionRef,
      at: turn.at,
      text: clip(turn.text, maxChars),
      context: `${tools}${clip(lastAssistant.text, 240)}`,
    });
  }

  return signals;
}

type ClaudeContentPart = { type: string; text?: string; name?: string };
type ClaudeLine = {
  type?: string;
  isMeta?: boolean;
  timestamp?: string;
  origin?: { kind?: string };
  message?: { content?: string | ClaudeContentPart[] };
};

// Claude Code writes one JSON object per line; human turns carry string or text
// content, tool results come back as user lines with tool_result parts.
export function parseClaudeTranscript(raw: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];

  for (const line of raw.split("\n")) {
    let entry: ClaudeLine;
    try {
      entry = JSON.parse(line) as ClaudeLine;
    } catch {
      continue;
    }
    const content = entry.message?.content;
    const at = entry.timestamp ?? "";
    const parts: ClaudeContentPart[] = typeof content === "string" ? [{ type: "text", text: content }] : (content ?? []);

    if (entry.type === "assistant") {
      const text = parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join(" ");
      const tools = parts.filter((part) => part.type === "tool_use").map((part) => part.name ?? "tool");
      // Streaming splits one assistant turn across lines; merge them.
      const previous = turns.at(-1);
      if (previous?.role === "assistant") {
        previous.text = `${previous.text} ${text}`.trim();
        previous.tools.push(...tools);
      } else {
        turns.push({ role: "assistant", at, text, tools });
      }
    } else if (entry.type === "user" && !entry.isMeta && entry.origin?.kind !== "tool") {
      if (parts.some((part) => part.type === "tool_result")) continue;
      // Harness-injected blocks (system reminders, command wrappers) start with a tag.
      const text = parts
        .filter((part) => part.type === "text" && !(part.text ?? "").trimStart().startsWith("<"))
        .map((part) => part.text ?? "")
        .join(" ")
        .trim();
      if (text) turns.push({ role: "user", at, text, tools: [] });
    }
  }

  return turns;
}

function claudeProjectDirs(projectsRoot: string, localPath: string): string[] {
  if (!existsSync(projectsRoot)) return [];
  const encoded = localPath.replace(/[^a-zA-Z0-9]/g, "-");
  return readdirSync(projectsRoot)
    .filter((name) => name === encoded || name.startsWith(`${encoded}-`))
    .map((name) => join(projectsRoot, name));
}

function collectClaude(projectsRoot: string, localPath: string, since: string, maxChars: number): { signals: Signal[]; status: string } {
  const signals: Signal[] = [];
  let files = 0;
  let humanTurns = 0;

  for (const dir of claudeProjectDirs(projectsRoot, localPath)) {
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".jsonl"))) {
      files += 1;
      const turns = parseClaudeTranscript(readFileSync(join(dir, file), "utf8"));
      humanTurns += turns.filter((turn) => turn.role === "user" && turn.at >= since).length;
      signals.push(...correctionsFromTurns(turns, `claude:${file.slice(0, 8)}`, since, maxChars));
    }
  }

  return { signals, status: `${files} files, ${humanTurns} human turns, ${signals.length} flagged` };
}

// OpenCode schema is read from the live database, not assumed: session, message
// and part tables with JSON `data` columns. If the shape differs, fail loudly
// with the actual schema so the caller can adapt the query.
function collectOpenCode(dbPath: string, localPath: string, since: string, maxChars: number): { signals: Signal[]; status: string } {
  if (!existsSync(dbPath)) return { signals: [], status: `not found at ${dbPath}` };

  const db = new Database(dbPath, { readonly: true });
  try {
    const columns = (table: string) =>
      new Set((db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name));
    const required: Record<string, string[]> = {
      session: ["id", "directory", "time_created"],
      message: ["id", "session_id", "time_created", "data"],
      part: ["message_id", "time_created", "data"],
    };
    for (const [table, names] of Object.entries(required)) {
      const present = columns(table);
      const missing = names.filter((name) => !present.has(name));
      if (missing.length) {
        const schema = (db.query("SELECT sql FROM sqlite_master WHERE type = 'table'").all() as { sql: string }[])
          .map((row) => row.sql)
          .join("\n");
        throw new Error(`opencode.db table ${table} lacks ${missing.join(", ")}. Actual schema:\n${schema}`);
      }
    }

    const newest = (db.query("SELECT MAX(time_created) AS t FROM session").get() as { t: number | null }).t ?? 0;
    const sinceValue = newest > 1e12 ? Date.parse(since) : Date.parse(since) / 1000;
    const toIso = (value: number) => new Date(newest > 1e12 ? value : value * 1000).toISOString();

    const sessions = db
      .query("SELECT id FROM session WHERE (directory = ?1 OR directory LIKE ?2) AND time_created >= ?3 ORDER BY time_created")
      .all(localPath, `${localPath}/%`, sinceValue) as { id: string }[];

    const messageQuery = db.query("SELECT id, time_created, data FROM message WHERE session_id = ?1 ORDER BY time_created");
    const partQuery = db.query("SELECT data FROM part WHERE message_id = ?1 ORDER BY time_created");
    const signals: Signal[] = [];

    for (const session of sessions) {
      const turns: TranscriptTurn[] = [];
      for (const message of messageQuery.all(session.id) as { id: string; time_created: number; data: string }[]) {
        const role = (JSON.parse(message.data) as { role?: string }).role;
        if (role !== "user" && role !== "assistant") continue;
        const parts = (partQuery.all(message.id) as { data: string }[]).map(
          (row) => JSON.parse(row.data) as { type?: string; text?: string; tool?: string; synthetic?: boolean },
        );
        turns.push({
          role,
          at: toIso(message.time_created),
          text: parts.filter((part) => part.type === "text" && !part.synthetic).map((part) => part.text ?? "").join(" ").trim(),
          tools: parts.filter((part) => part.type === "tool").map((part) => part.tool ?? "tool"),
        });
      }
      signals.push(...correctionsFromTurns(turns.filter((turn) => turn.role === "assistant" || turn.text), `opencode:${session.id}`, since, maxChars));
    }

    return { signals, status: `${sessions.length} sessions, ${signals.length} flagged` };
  } finally {
    db.close();
  }
}

// --- Digest ---------------------------------------------------------------

function renderDigest(
  target: string,
  since: string,
  sources: SourceReport[],
  pulls: PullSummary[],
  signals: Signal[],
  collapsed: CollapsedNotice[],
): string {
  const lines: string[] = [`# Friction digest: ${target}`, "", `Window: ${since} to ${new Date().toISOString().slice(0, 10)}`, "", "## Sources", ""];
  for (const source of sources) lines.push(`- ${source.name}: ${source.status}`);

  if (pulls.length) {
    lines.push("", "## Pull requests in window", "");
    for (const pull of pulls) lines.push(`- #${pull.number} ${pull.merged ? "merged" : pull.state} — ${pull.title}`);
  }

  const threadSignals = signals.filter((signal) => ["review", "inline-review", "thread-comment"].includes(signal.source));
  if (threadSignals.length) {
    lines.push("", "## Review and discussion signals", "");
    const byRef = Map.groupBy(threadSignals, (signal) => signal.ref);
    const titles = new Map(pulls.map((pull) => [`#${pull.number}`, pull.title]));
    for (const [ref, group] of [...byRef].sort(([a], [b]) => Number(b.slice(1)) - Number(a.slice(1)))) {
      lines.push(`### ${ref}${titles.has(ref) ? ` ${titles.get(ref)}` : ""}`, "");
      for (const signal of group.sort((a, b) => a.at.localeCompare(b.at))) {
        lines.push(`- [${signal.at.slice(0, 10)} ${signal.author}${signal.bot ? " (bot)" : ""} ${signal.source}] ${signal.text}`);
      }
      lines.push("");
    }
  }

  if (collapsed.length) {
    lines.push("## Repeated bot notices (collapsed)", "");
    for (const notice of collapsed) lines.push(`- ${notice.count}× ${notice.author}: "${notice.firstLine}" on ${notice.refs.join(", ")}`);
    lines.push("");
  }

  const runs = signals.filter((signal) => signal.source === "failed-run");
  if (runs.length) {
    lines.push("## Failed workflow runs", "");
    for (const [workflow, group] of Map.groupBy(runs, (signal) => signal.text.split(" failed on ")[0] ?? "")) {
      lines.push(`- ${workflow}: ${group.length} failures on ${[...new Set(group.map((signal) => signal.ref))].join(", ")}`);
    }
    lines.push("");
  }

  const commits = signals.filter((signal) => signal.source === "fix-commit");
  if (commits.length) {
    lines.push("## Fix-like commits", "");
    for (const commit of commits) lines.push(`- ${commit.ref} ${commit.at} ${commit.text}`);
    lines.push("");
  }

  const corrections = signals.filter((signal) => signal.source === "transcript");
  if (corrections.length) {
    lines.push("## Transcript corrections (user turn after an agent action)", "");
    for (const [ref, group] of Map.groupBy(corrections, (signal) => signal.ref)) {
      lines.push(`### ${ref}`, "");
      for (const signal of group) lines.push(`- [${signal.at.slice(0, 16)}] agent: ${signal.context}`, `  user: ${signal.text}`);
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      "local-path": { type: "string", default: process.cwd() },
      since: { type: "string", default: new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10) },
      out: { type: "string" },
      "claude-projects": { type: "string", default: join(homedir(), ".claude", "projects") },
      "opencode-db": { type: "string", default: join(homedir(), ".local", "share", "opencode", "opencode.db") },
      "max-prs": { type: "string", default: "150" },
      "max-chars": { type: "string", default: "700" },
      "no-github": { type: "boolean", default: false },
      "no-transcripts": { type: "boolean", default: false },
    },
  });

  const localPath = resolve(values["local-path"]!);
  const since = values.since!;
  const maxChars = Number(values["max-chars"]);
  const target = values.repo ?? localPath;
  const out = resolve(values.out ?? join(tmpdir(), "friction", target.replace(/[^a-zA-Z0-9]+/g, "-")));
  const sources: SourceReport[] = [];
  const signals: Signal[] = [];
  let pulls: PullSummary[] = [];

  const attempt = (name: string, run: () => string) => {
    try {
      sources.push({ name, status: run() });
    } catch (error) {
      sources.push({ name, status: `FAILED: ${(error as Error).message}` });
    }
  };

  if (values.repo && !values["no-github"]) {
    try {
      const github = await collectGitHub(values.repo, since, Number(values["max-prs"]), maxChars);
      pulls = github.pulls;
      signals.push(...github.signals);
      sources.push({ name: "github", status: `${pulls.length} PRs, ${github.signals.length} signals` });
    } catch (error) {
      sources.push({ name: "github", status: `FAILED: ${(error as Error).message}` });
    }
  }

  if (existsSync(join(localPath, ".git"))) {
    attempt("git log", () => {
      const commits = collectFixCommits(localPath, since);
      signals.push(...commits);
      return `${commits.length} fix-like commits`;
    });
  }

  if (!values["no-transcripts"]) {
    attempt("claude code transcripts", () => {
      const result = collectClaude(values["claude-projects"]!, localPath, since, maxChars);
      signals.push(...result.signals);
      return result.status;
    });
    attempt("opencode.db", () => {
      const result = collectOpenCode(values["opencode-db"]!, localPath, since, maxChars);
      signals.push(...result.signals);
      return result.status;
    });
  }

  const { kept, collapsed } = collapseBotNotices(signals);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "signals.json"), `${JSON.stringify(signals, null, 2)}\n`);
  writeFileSync(join(out, "digest.md"), renderDigest(target, since, sources, pulls, kept, collapsed));

  for (const source of sources) console.log(`${source.name}: ${source.status}`);
  console.log(`digest: ${join(out, "digest.md")}`);
}

if (import.meta.main) {
  await main();
}
