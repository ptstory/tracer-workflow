type Verdict = "needs-fix" | "merge-candidate" | "needs-human" | "blocked";

type GateComment = {
  verdict: Verdict;
  headSha: string;
  reviewRound: number;
  reviewedFiles: number;
  commentedAt: string;
};

type Comment = { author: { login: string } | null; body: string; createdAt: string };

function reviewerLogins(): Set<string> {
  const logins = new Set((process.env.TRACER_REVIEWER_LOGINS ?? "").split(",").map((login) => login.trim().toLowerCase()).filter(Boolean));
  if (logins.size === 0) throw new Error("TRACER_REVIEWER_LOGINS must contain at least one reviewer login");
  return logins;
}

function trustedComments(comments: Comment[]): Comment[] {
  const logins = reviewerLogins();
  return comments.filter((comment) => {
    if (!comment.body.startsWith("## review-gate:")) return false;
    if (comment.author?.login && logins.has(comment.author.login.toLowerCase())) return true;
    console.warn(`Ignoring review-gate comment from non-allowlisted author ${comment.author?.login ?? "unknown"}`);
    return false;
  });
}

const VALID_VERDICTS = new Set<Verdict>(["needs-fix", "merge-candidate", "needs-human", "blocked"]);

type ParseGateCommentResult =
  | { kind: "none" }
  | { kind: "invalid"; comment: Comment }
  | { kind: "parsed"; verdict: GateComment };

function parseIntegerField(body: string, field: string): number | null {
  const match = body.match(new RegExp(`^${field}:\\s*(\\d+)\\s*$`, "m"));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

function parseGateBody(body: string): Omit<GateComment, "commentedAt"> | null {
  if (!body.startsWith("## review-gate:")) return null;

  const verdictMatch = body.match(/^## review-gate:\s*(\S+)/);
  if (!verdictMatch) return null;

  const verdict = verdictMatch[1] as Verdict;
  if (!VALID_VERDICTS.has(verdict)) return null;

  const headShaMatch = body.match(/^head-sha:\s*([0-9a-f]{40})\s*$/m);
  if (!headShaMatch) return null;

  const reviewRound = parseIntegerField(body, "review-round");
  if (reviewRound === null) return null;

  const reviewedFiles = parseIntegerField(body, "reviewed-files");
  if (reviewedFiles === null) return null;

  return { verdict, headSha: headShaMatch[1], reviewRound, reviewedFiles };
}

function parseGateComment(comments: Comment[]): ParseGateCommentResult {
  let latestMarked: Comment | null = null;

  for (const comment of trustedComments(comments)) {

    if (!latestMarked || comment.createdAt >= latestMarked.createdAt) {
      latestMarked = comment;
    }
  }

  if (!latestMarked) return { kind: "none" };

  const parsed = parseGateBody(latestMarked.body);
  if (!parsed) return { kind: "invalid", comment: latestMarked };

  return { kind: "parsed", verdict: { ...parsed, commentedAt: latestMarked.createdAt } };
}

function latestConformingGateComment(comments: Comment[]): GateComment | null {
  let latest: GateComment | null = null;

  for (const comment of trustedComments(comments)) {

    const parsed = parseGateBody(comment.body);
    if (!parsed) continue;

    if (!latest || comment.createdAt >= latest.commentedAt) {
      latest = { ...parsed, commentedAt: comment.createdAt };
    }
  }

  return latest;
}

export type { Verdict, GateComment, Comment };
export { latestConformingGateComment, parseGateBody, parseGateComment, reviewerLogins };
