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

type State = Record<string, string>; // prNumber -> sha we already actioned

function loadState(): State {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
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
  // We don't capture output here; the agent posts its result back to the PR,
  // which is where the next verdict cycle reads from.
  execFileSync("opencode", ["run", prompt], {
    stdio: "inherit",
    cwd: process.env.RG_WORKDIR ?? process.cwd(),
  });
}

// --- main ---------------------------------------------------------------------

function main(): void {
  const state = loadState();
  let changed = false;

  for (const pr of openPRs()) {
    const v = latestVerdict(pr.number);
    if (!v) continue;

    // SHA-staleness rule: verdict only valid on current head.
    if (v.headSha !== pr.headRefOid) continue;

    // Only needs-fix triggers autonomous action. merge-candidate/needs-human/
    // blocked surface to the human — the poller does not merge or escalate.
    if (v.state !== "needs-fix") continue;

    // Idempotency: don't re-trigger on a verdict+SHA we already actioned.
    if (state[pr.number] === pr.headRefOid) continue;

    console.log(`PR #${pr.number}: needs-fix on ${pr.headRefOid}, triggering fix pass`);
    triggerFixPass(pr);

    state[pr.number] = pr.headRefOid;
    changed = true;
  }

  if (changed) saveState(state);
}

main();
