#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { latestConformingGateComment, reviewerLogins, type Comment } from "../lib/verdict";

const PR_URL_PATTERN = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/;

type PullRequest = {
  number: number;
  headRefOid: string;
  comments: Comment[];
};

function parsePullRequestUrl(value: string): { owner: string; repository: string; number: number } {
  const match = value.match(PR_URL_PATTERN);
  if (!match) throw new Error("expected a GitHub pull request URL in the form https://github.com/<owner>/<repo>/pull/<n>");
  return { owner: match[1], repository: match[2], number: Number(match[3]) };
}

function readPullRequest(owner: string, repository: string, number: number): PullRequest {
  const output = execFileSync("gh", [
    "pr", "view", String(number), "--repo", `${owner}/${repository}`, "--json", "number,headRefOid,comments",
  ], { encoding: "utf8" });
  const payload = JSON.parse(output) as Partial<PullRequest>;
  if (payload.number !== number || typeof payload.headRefOid !== "string" || !/^[0-9a-f]{40}$/i.test(payload.headRefOid) || !Array.isArray(payload.comments)) {
    throw new Error("GitHub returned incomplete pull request or comment data");
  }
  const comments = payload.comments.map((comment) => {
    if (!comment || typeof comment !== "object" || typeof comment.body !== "string" || typeof comment.createdAt !== "string") {
      throw new Error("GitHub returned an incomplete pull request comment");
    }
    return {
      ...comment,
      author: comment.author && typeof comment.author.login === "string" ? comment.author : null,
    };
  });
  return { number, headRefOid: payload.headRefOid, comments };
}

function nextActionFor(comments: Comment[], gate: NonNullable<ReturnType<typeof latestConformingGateComment>>): string {
  const trustedReviewers = reviewerLogins();
  const comment = comments.find((candidate) => {
    if (!candidate.author?.login || !trustedReviewers.has(candidate.author.login.toLowerCase())) return false;
    if (candidate.createdAt !== gate.commentedAt) return false;
    return candidate.body.startsWith(`## review-gate: ${gate.verdict}`) &&
      candidate.body.split(/\r?\n/).includes(`head-sha: ${gate.headSha}`);
  });
  return comment?.body.match(/^next-action:[ \t]*(.*?)\s*$/m)?.[1] ?? "not recorded";
}

function main(argv: string[] = process.argv.slice(2)): void {
  if (argv.length !== 1) {
    process.stderr.write("usage: bun tooling/review-gate-autosend/review-gate-autosend.ts <PR_URL>\n");
    process.exitCode = 2;
    return;
  }

  let pullRequestUrl: string;
  let target: ReturnType<typeof parsePullRequestUrl>;
  try {
    target = parsePullRequestUrl(argv[0]);
    pullRequestUrl = argv[0];
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`PR URL: ${pullRequestUrl}\n`);
  try {
    reviewerLogins();
    const pullRequest = readPullRequest(target.owner, target.repository, target.number);
    const gate = latestConformingGateComment(pullRequest.comments, { pullRequestNumber: target.number });
    if (gate && gate.headSha === pullRequest.headRefOid.toLowerCase()) {
      process.stdout.write(`Current Review Gate verdict: ${gate.verdict}\n`);
      process.stdout.write(`Next action: ${nextActionFor(pullRequest.comments, gate)}\n`);
      return;
    }

    const prompt = `@review-gate ${pullRequestUrl}`;
    const reviewGateUrl = `https://chatgpt.com/?autosend=1&q=${encodeURIComponent(prompt)}`;
    process.stdout.write(`Opening Review Gate: ${reviewGateUrl}\n`);
    execFileSync("open", ["-g", reviewGateUrl], { stdio: "ignore" });
  } catch (error) {
    process.stderr.write(`Unable to verify the current Review Gate verdict; not launching: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) main();

export { main, nextActionFor, parsePullRequestUrl };
