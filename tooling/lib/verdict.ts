type Verdict = "needs-fix" | "merge-candidate" | "needs-human" | "blocked";

type GateComment = {
  verdict: Verdict;
  headSha: string;
  commentedAt: string;
};

type Comment = { body: string; createdAt: string };

const VALID_VERDICTS = new Set<Verdict>(["needs-fix", "merge-candidate", "needs-human", "blocked"]);

function parseGateBody(body: string): Omit<GateComment, "commentedAt"> | null {
  if (!body.startsWith("## review-gate:")) return null;

  const verdictMatch = body.match(/^## review-gate:\s*(\S+)/);
  if (!verdictMatch) return null;

  const verdict = verdictMatch[1] as Verdict;
  if (!VALID_VERDICTS.has(verdict)) return null;

  const headShaMatch = body.match(/^head-sha:\s*([0-9a-f]{40})\s*$/m);
  if (!headShaMatch) return null;

  return { verdict, headSha: headShaMatch[1] };
}

function parseGateComment(comments: Comment[]): GateComment | null {
  let latest: GateComment | null = null;

  for (const comment of comments) {
    const parsed = parseGateBody(comment.body);
    if (!parsed) continue;

    if (!latest || comment.createdAt >= latest.commentedAt) {
      latest = { ...parsed, commentedAt: comment.createdAt };
    }
  }

  return latest;
}

export type { Verdict, GateComment };
export { parseGateComment };
