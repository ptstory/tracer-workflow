import { parseGateComment, reviewerLogins } from "./verdict";
import type { Comment } from "./verdict";

type GitHubComment = {
  body: string;
  created_at: string;
  user: { login: string } | null;
};

const comments = JSON.parse(await Bun.stdin.text()) as GitHubComment[];
const pullRequestNumber = Number(process.env.PR_NUMBER);
const parsed = parseGateComment(comments.map((comment): Comment => ({
  author: comment.user,
  body: comment.body,
  createdAt: comment.created_at,
  pullRequestNumber,
})));
const logins = reviewerLogins();
const ignoredAuthors = comments
  .filter((comment) => comment.body.startsWith("## review-gate:") && (!comment.user?.login || !logins.has(comment.user.login.toLowerCase())))
  .map((comment) => comment.user?.login ?? "unknown");

if (parsed.kind === "parsed") {
  process.stdout.write(JSON.stringify({
    status: "valid",
    details: {
      verdict: parsed.verdict.verdict,
      head_sha: parsed.verdict.headSha,
      review_round: parsed.verdict.reviewRound,
      reviewed_files: parsed.verdict.reviewedFiles,
    },
    ignoredAuthors: [...new Set(ignoredAuthors)].sort(),
  }));
} else {
  process.stdout.write(JSON.stringify({ status: parsed.kind, details: null, ignoredAuthors: [...new Set(ignoredAuthors)].sort() }));
}
