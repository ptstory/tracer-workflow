type Verdict = "needs-fix" | "merge-candidate" | "needs-human" | "blocked";

type GateComment = {
  verdict: Verdict;
  headSha: string;
  reviewRound: number;
  reviewedFiles: number;
  commentedAt: string;
};

type Comment = { author: { login: string } | null; body: string; createdAt: string; pullRequestNumber?: number };

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
const NEXT_ACTION_REQUIRED_SINCE = "2026-09-26T20:18:26Z";

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

function validNextAction(verdict: Verdict, nextAction: string, headSha: string, pullRequestNumber?: number): boolean {
  if (verdict === "needs-fix") {
    const match = nextAction.match(/^from-pr-review https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)$/);
    return match !== null && (pullRequestNumber === undefined || Number(match[1]) === pullRequestNumber);
  }
  if (verdict === "merge-candidate") {
    const readyMatch = nextAction.match(/^gh pr ready (\d+)$/);
    const mergeMatch = nextAction.match(new RegExp(`^gh pr merge (\\d+) --squash --match-head-commit ${headSha}$`));
    return (readyMatch !== null && (pullRequestNumber === undefined || Number(readyMatch[1]) === pullRequestNumber)) ||
      (mergeMatch !== null && (pullRequestNumber === undefined || Number(mergeMatch[1]) === pullRequestNumber));
  }
  if (verdict === "needs-human") {
    const match = nextAction.match(/^gh pr view (\d+) --web$/);
    return match !== null && (pullRequestNumber === undefined || Number(match[1]) === pullRequestNumber);
  }
  const checksMatch = nextAction.match(/^gh pr checks (\d+)$/);
  return (checksMatch !== null && (pullRequestNumber === undefined || Number(checksMatch[1]) === pullRequestNumber)) ||
    /^gh (?:api \S+|pr view \d+(?: --web)?|run view \d+(?: --log)?|variable get \S+(?: -R \S+)?)$/.test(nextAction);
}

function parseGateBody(body: string, commentedAt?: string, pullRequestNumber?: number): Omit<GateComment, "commentedAt"> | null {
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

  const blockingSetMatches = [...body.matchAll(/^blocking-set:[ \t]*(.*?)\s*$/gm)];
  if (blockingSetMatches.length !== 1) return null;
  const blockingSet = blockingSetMatches[0][1].trim();
  const blockingTargets = blockingSet === "" ? [] : blockingSet.split(",").map((target) => target.trim());
  if (blockingTargets.some((target) => target.length === 0)) return null;
  if (verdict === "needs-fix" && blockingTargets.length === 0) return null;
  if ((verdict === "merge-candidate" || verdict === "needs-human") && blockingTargets.length > 0) return null;

  const nextActionMatches = [...body.matchAll(/^next-action:[ \t]*(.*?)\s*$/gm)];
  if (nextActionMatches.length > 1) return null;
  if (nextActionMatches.length === 0) {
    if (!commentedAt || !Number.isFinite(Date.parse(commentedAt)) || Date.parse(commentedAt) >= Date.parse(NEXT_ACTION_REQUIRED_SINCE)) return null;
  } else if (!validNextAction(verdict, nextActionMatches[0][1].trim(), headShaMatch[1], pullRequestNumber)) {
    return null;
  }

  return { verdict, headSha: headShaMatch[1], reviewRound, reviewedFiles };
}

function parseGateComment(comments: Comment[]): ParseGateCommentResult {
  const trusted = trustedComments(comments);
  let latestConforming: GateComment | null = null;

  for (const comment of trusted) {
    const parsed = parseGateBody(comment.body, comment.createdAt, comment.pullRequestNumber);
    if (!parsed) continue;

    if (!latestConforming || comment.createdAt >= latestConforming.commentedAt) {
      latestConforming = { ...parsed, commentedAt: comment.createdAt };
    }
  }

  if (latestConforming) return { kind: "parsed", verdict: latestConforming };

  let latestMarked: Comment | null = null;
  for (const comment of trusted) {
    if (!latestMarked || comment.createdAt >= latestMarked.createdAt) latestMarked = comment;
  }
  if (!latestMarked) return { kind: "none" };
  return { kind: "invalid", comment: latestMarked };
}

function latestConformingGateComment(comments: Comment[]): GateComment | null {
  let latest: GateComment | null = null;

  for (const comment of trustedComments(comments)) {

    const parsed = parseGateBody(comment.body, comment.createdAt, comment.pullRequestNumber);
    if (!parsed) continue;

    if (!latest || comment.createdAt >= latest.commentedAt) {
      latest = { ...parsed, commentedAt: comment.createdAt };
    }
  }

  return latest;
}

export type { Verdict, GateComment, Comment };
export { latestConformingGateComment, parseGateBody, parseGateComment, reviewerLogins };
