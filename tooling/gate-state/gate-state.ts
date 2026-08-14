#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { parseGateComment, type GateComment } from "../lib/verdict";

const REPOS = [
  "ptstory/core-tweaks",
  "ptstory/retro-learnings",
  "ptstory/thread-atlas",
  "ptstory/tracer-workflow",
] as const;

type PRComment = {
  body: string;
  createdAt: string;
};

type OpenPR = {
  number: number;
  title: string;
  headRefOid: string;
  comments: PRComment[];
  isDraft: boolean;
};

type GateState = {
  repo: string;
  number: number;
  title: string;
  isDraft: boolean;
  gateState: "ungated" | "current" | "stale";
  headRefOid: string;
  gateHeadSha: string | null;
  gateCommentedAt: string | null;
};

type ParsedArgs = {
  json: boolean;
  countOpen: boolean;
};

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function listOpenPRs(repo: string): OpenPR[] {
  const out = gh([
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--json",
    "number,title,headRefOid,comments,isDraft",
  ]);
  return JSON.parse(out) as OpenPR[];
}

function classifyGateState(repo: string, pr: OpenPR): GateState {
  const gate: GateComment | null = parseGateComment(pr.comments);
  if (!gate) {
    return {
      repo,
      number: pr.number,
      title: pr.title,
      isDraft: pr.isDraft,
      gateState: "ungated",
      headRefOid: pr.headRefOid,
      gateHeadSha: null,
      gateCommentedAt: null,
    };
  }

  return {
    repo,
    number: pr.number,
    title: pr.title,
    isDraft: pr.isDraft,
    gateState: gate.headSha === pr.headRefOid ? "current" : "stale",
    headRefOid: pr.headRefOid,
    gateHeadSha: gate.headSha,
    gateCommentedAt: gate.commentedAt,
  };
}

function collectGateStates(repos: readonly string[] = REPOS): GateState[] {
  const rows = repos.flatMap((repo) => listOpenPRs(repo).map((pr) => classifyGateState(repo, pr)));
  return rows.sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { json: false, countOpen: false };

  for (const arg of argv) {
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--count-open") {
      args.countOpen = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return args;
}

function countOpen(rows: GateState[]): number {
  return rows.filter((row) => !row.isDraft).length;
}

function formatTable(rows: GateState[]): string {
  const headers = ["repo", "number", "draft", "state", "title"];
  const values = rows.map((row) => [
    row.repo,
    String(row.number),
    row.isDraft ? "draft" : "",
    row.gateState,
    row.title,
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...values.map((row) => row[index].length)));
  const line = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();

  if (values.length === 0) return line(headers);

  return [line(headers), ...values.map(line)].join("\n");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const rows = collectGateStates();

  if (args.countOpen) {
    process.stdout.write(`${countOpen(rows)}\n`);
    return;
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatTable(rows)}\n`);
}

if (import.meta.main) main();

export type { GateState, OpenPR };
export { REPOS, classifyGateState, collectGateStates, countOpen, formatTable, listOpenPRs, main, parseArgs };
