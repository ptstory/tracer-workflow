type Verdict = "needs-fix" | "merge-candidate" | "needs-human" | "blocked";

type GateComment = {
  verdict: Verdict;
  headSha: string;
  reviewRound: number;
  reviewedFiles: number;
  commentedAt: string;
};

type Comment = { body: string; createdAt: string };

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

  for (const comment of comments) {
    if (!comment.body.startsWith("## review-gate:")) continue;

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

  for (const comment of comments) {
    if (!comment.body.startsWith("## review-gate:")) continue;

    const parsed = parseGateBody(comment.body);
    if (!parsed) continue;

    if (!latest || comment.createdAt >= latest.commentedAt) {
      latest = { ...parsed, commentedAt: comment.createdAt };
    }
  }

  return latest;
}

export type { Verdict, GateComment };
export { latestConformingGateComment, parseGateBody, parseGateComment };
