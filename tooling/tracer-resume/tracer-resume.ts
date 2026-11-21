#!/usr/bin/env bun

import { REPOS, readPullRequestGateState, type ResolvedGateState } from "../gate-state/gate-state";

const PR_URL_PATTERN = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)$/;

type PullRequestReference = {
  repo: string;
  number: number;
  url: string;
};

type ResumeDecision = {
  prUrl: string;
  headSha: string;
  state: "review-gate" | "from-pr-review" | "needs-human" | "blocked" | "human-checks";
  reason?: "no-current-verdict" | "stale-verdict" | "malformed-verdict" | "check current-head checks and human/AFK authorization";
  invocation?: string;
};

function parsePullRequestReference(value: string): PullRequestReference {
  if (/^\d+$/.test(value)) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("pull request number is out of range");
    return { repo: REPOS[0], number, url: `https://github.com/${REPOS[0]}/pull/${number}` };
  }

  const match = value.match(PR_URL_PATTERN);
  if (!match) throw new Error("expected a GitHub pull request URL or a pull request number");
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number)) throw new Error("pull request number is out of range");
  const repo = `${match[1]}/${match[2]}`;
  return { repo, number, url: `https://github.com/${repo}/pull/${number}` };
}

function decideResume(prUrl: string, resolved: ResolvedGateState): ResumeDecision {
  const { state, verdict, verdictStatus } = resolved;
  if (state.gateState !== "current" || !verdict || verdict.headSha.toLowerCase() !== state.headRefOid.toLowerCase()) {
    const reason = verdictStatus === "invalid"
      ? "malformed-verdict"
      : state.gateState === "stale"
        ? "stale-verdict"
        : "no-current-verdict";
    return {
      prUrl,
      headSha: state.headRefOid,
      state: "review-gate",
      reason,
      invocation: `@review-gate ${prUrl}`,
    };
  }

  if (verdict.verdict === "needs-fix") {
    return {
      prUrl,
      headSha: state.headRefOid,
      state: "from-pr-review",
      invocation: `from-pr-review ${prUrl}`,
    };
  }

  if (verdict.verdict === "merge-candidate") {
    return {
      prUrl,
      headSha: state.headRefOid,
      state: "human-checks",
      reason: "check current-head checks and human/AFK authorization",
    };
  }

  return {
    prUrl,
    headSha: state.headRefOid,
    state: verdict.verdict,
  };
}

function formatDecision(decision: ResumeDecision): string {
  const lines = [
    `PR: ${decision.prUrl}`,
    `Head SHA: ${decision.headSha}`,
    `State: ${decision.state}`,
  ];
  if (decision.reason) lines.push(`Reason: ${decision.reason}`);
  if (decision.invocation) lines.push(`Invocation: ${decision.invocation}`);
  return `${lines.join("\n")}\n`;
}

function resume(input: string): string {
  const reference = parsePullRequestReference(input);
  const resolved = readPullRequestGateState(reference.repo, reference.number);
  return formatDecision(decideResume(reference.url, resolved));
}

export { decideResume, formatDecision, parsePullRequestReference, resume };
export type { PullRequestReference, ResumeDecision };
