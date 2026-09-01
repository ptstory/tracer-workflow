#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { collectGateStates, type GateState } from "../gate-state/gate-state";
import { parseGateComment } from "../lib/verdict";

type PRDetails = {
  body: string;
  comments: Array<{ body: string; createdAt: string }>;
};

type Packet = {
  repo: string;
  number: number;
  title: string;
  headRefOid: string;
  gateState: "ungated" | "stale";
  issueText: string;
  priorVerdictText: string;
  diffText: string;
};

type ParsedArgs = {
  limit: number;
  budget: number;
  stdout: boolean;
};

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function pbcopy(text: string): void {
  execFileSync("pbcopy", [], {
    input: text,
    encoding: "utf8",
    stdio: ["pipe", "ignore", "pipe"],
  });
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { limit: 4, budget: 200000, stdout: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--stdout") {
      args.stdout = true;
      continue;
    }

    if (arg === "--limit") {
      const value = argv[++i];
      if (value === undefined) throw new Error("--limit requires a value");
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`invalid --limit: ${value}`);
      args.limit = parsed;
      continue;
    }

    if (arg === "--budget") {
      const value = argv[++i];
      if (value === undefined) throw new Error("--budget requires a value");
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`invalid --budget: ${value}`);
      args.budget = parsed;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return args;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function latestGateComment(comments: Array<{ body: string; createdAt: string }>): { body: string; createdAt: string } | null {
  let latest: { body: string; createdAt: string } | null = null;

  for (const comment of comments) {
    if (!comment.body.startsWith("## review-gate:")) continue;
    if (!latest || comment.createdAt >= latest.createdAt) latest = comment;
  }

  if (!latest) return null;
  const parsed = parseGateComment([latest]);
  return parsed.kind === "parsed" ? latest : null;
}

function warn(message: string): void {
  process.stderr.write(`warning: ${message}\n`);
}

function loadPrDetails(repo: string, number: number): PRDetails {
  try {
    const out = gh(["pr", "view", String(number), "--repo", repo, "--json", "body,comments"]);
    return JSON.parse(out) as PRDetails;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`failed to load PR #${number} from ${repo}: ${message}`);
    return { body: "", comments: [] };
  }
}

function parseIssueNumber(body: string): number | null {
  const pattern = /(?:Closes|Fixes|Resolves)\s+#(\d+)|https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)/gi;
  const match = pattern.exec(body);
  if (!match) return null;
  const value = match[1] ?? match[2];
  return value ? Number(value) : null;
}

function loadIssueText(repo: string, issueNumber: number): string {
  try {
    return gh(["issue", "view", String(issueNumber), "--repo", repo]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`failed to load issue #${issueNumber} from ${repo}: ${message}`);
    return "none";
  }
}

function loadDiffText(repo: string, number: number): string {
  try {
    return gh(["pr", "diff", String(number), "--repo", repo]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`failed to load diff for PR #${number} from ${repo}: ${message}`);
    return "none";
  }
}

function buildPacket(row: {
  repo: string;
  number: number;
  title: string;
  headRefOid: string;
  gateState: "ungated" | "stale";
}): Packet {
  const details = loadPrDetails(row.repo, row.number);
  const issueNumber = parseIssueNumber(details.body);
  const issueText = issueNumber === null ? "none" : loadIssueText(row.repo, issueNumber).trimEnd() || "none";
  const verdict = latestGateComment(details.comments);
  const priorVerdictText = verdict?.body.trimEnd() || "none";
  const diffText = loadDiffText(row.repo, row.number).trimEnd() || "none";

  return {
    repo: row.repo,
    number: row.number,
    title: row.title,
    headRefOid: row.headRefOid,
    gateState: row.gateState,
    issueText,
    priorVerdictText,
    diffText,
  };
}

function renderPacket(packet: Packet): string {
  return [
    `=== ${packet.repo}#${packet.number} — ${packet.title}`,
    `head: ${shortSha(packet.headRefOid)}   gate: ${packet.gateState}`,
    `--- issue ---`,
    packet.issueText,
    `--- prior verdict ---`,
    packet.priorVerdictText,
    `--- diff ---`,
    packet.diffText,
  ].join("\n");
}

function splitDiffLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized === "") return [];
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function renderTruncatedDiff(lines: string[], keepCount: number): string {
  if (keepCount >= lines.length) return lines.join("\n");
  const cut = lines.length - keepCount;
  const note = `... truncated ${cut} lines ...`;
  return keepCount > 0 ? `${lines.slice(0, keepCount).join("\n")}\n${note}` : note;
}

function truncateDiffToBudget(text: string, targetBytes: number): string {
  if (text === "none") return text;

  const lines = splitDiffLines(text);
  const originalBytes = Buffer.byteLength(text, "utf8");
  if (originalBytes <= targetBytes) return text;

  let best = renderTruncatedDiff(lines, 0);
  let lo = 0;
  let hi = lines.length;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = renderTruncatedDiff(lines, mid);
    const candidateBytes = Buffer.byteLength(candidate, "utf8");

    if (candidateBytes <= targetBytes) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

function renderOutput(packets: Packet[], omitted: number[]): string {
  const body = packets.map(renderPacket).join("\n\n");
  const omittedText = omitted.length > 0 ? [`omitted`, ...omitted.map((number) => `- ${number}`)].join("\n") : "";
  if (!body) return omittedText;
  if (!omittedText) return body;
  return `${body}\n\n${omittedText}`;
}

function applyBudget(packets: Packet[], budget: number): { packets: Packet[]; omitted: number[] } {
  const working = [...packets];
  const omitted: number[] = [];

  while (true) {
    const current = renderOutput(working, omitted);
    if (Buffer.byteLength(current, "utf8") <= budget) return { packets: working, omitted };

    const candidates = working.filter((packet) => packet.diffText !== "none");
    if (candidates.length === 0) break;

    candidates.sort((a, b) => Buffer.byteLength(b.diffText, "utf8") - Buffer.byteLength(a.diffText, "utf8"));
    const target = candidates[0];
    const currentDiffBytes = Buffer.byteLength(target.diffText, "utf8");
    const excess = Buffer.byteLength(current, "utf8") - budget;
    const next = truncateDiffToBudget(target.diffText, Math.max(0, currentDiffBytes - excess));

    if (next === target.diffText) {
      break;
    }

    target.diffText = next;
  }

  while (working.length > 0 && Buffer.byteLength(renderOutput(working, omitted), "utf8") > budget) {
    const removed = working.pop();
    if (removed) omitted.unshift(removed.number);
  }

  return { packets: working, omitted };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const rows = collectGateStates().filter(
    (row): row is GateState & { gateState: "ungated" | "stale" } =>
      !row.isDraft && (row.gateState === "ungated" || row.gateState === "stale"),
  );
  const selected = rows.slice(0, args.limit);
  const packets = selected.map(buildPacket);
  const { packets: fitted, omitted } = applyBudget(packets, args.budget);
  const output = renderOutput(fitted, omitted);

  if (args.stdout) {
    process.stdout.write(output);
    return;
  }

  pbcopy(output);
}

if (import.meta.main) main();

export { applyBudget, buildPacket, latestGateComment, loadDiffText, loadIssueText, loadPrDetails, main, parseArgs, parseIssueNumber, pbcopy, renderOutput, renderPacket, truncateDiffToBudget };
