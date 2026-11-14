import { readFileSync } from "node:fs";

import { parseGateBody, reviewerLogins } from "./verdict";

type ApiComment = {
  id: number;
  user: { login: string } | null;
  body: string;
  created_at: string;
  updated_at?: string;
};

const pullRequestNumber = Number(process.argv[2]);
if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) {
  throw new Error("A valid pull request number is required");
}

const comments = JSON.parse(readFileSync(0, "utf8")) as ApiComment[];
const trustedReviewers = reviewerLogins();
const latestTrustedMarked = comments
  .filter((comment) => comment.body.startsWith("## review-gate:") && comment.user?.login && trustedReviewers.has(comment.user.login.toLowerCase()))
  .sort((left, right) => left.created_at.localeCompare(right.created_at))
  .at(-1);
const parsedVerdict = latestTrustedMarked
  ? parseGateBody(latestTrustedMarked.body, latestTrustedMarked.created_at, { pullRequestNumber })
  : null;

process.stdout.write(`${JSON.stringify({
  status: latestTrustedMarked ? (parsedVerdict ? "valid" : "invalid") : "none",
  commentId: latestTrustedMarked?.id ?? null,
  createdAt: latestTrustedMarked?.created_at ?? null,
  updatedAt: latestTrustedMarked?.updated_at ?? latestTrustedMarked?.created_at ?? null,
  verdict: parsedVerdict?.verdict ?? null,
  headSha: parsedVerdict?.headSha ?? null,
  reviewRound: parsedVerdict?.reviewRound ?? null,
  reviewedFiles: parsedVerdict?.reviewedFiles ?? null,
})}\n`);
