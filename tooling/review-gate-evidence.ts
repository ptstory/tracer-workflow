import { spawnSync } from "node:child_process";

type CheckRun = {
  head_sha?: string;
  name?: string;
  status?: string;
  conclusion?: string | null;
  event?: string;
};

type CommitStatus = {
  state?: string;
  context?: string;
  sha?: string;
};

type EvidenceState = "absent" | "pending" | "failed/cancelled" | "passed";

type EvidencePages = (endpoint: string) => Promise<unknown[]>;

export type ReviewGateEvidence = {
  head_sha: string;
  state: EvidenceState;
  check_runs: CheckRun[];
  statuses: CommitStatus[];
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("GitHub returned an invalid evidence page");
  }
  return value as Record<string, unknown>;
}

function collectCheckRuns(pages: unknown[]): CheckRun[] {
  return pages.flatMap((page) => {
    const checkRuns = asRecord(page).check_runs;
    if (!Array.isArray(checkRuns)) {
      throw new Error("GitHub returned a check-runs page without check_runs");
    }
    return checkRuns.map((checkRun) => asRecord(checkRun) as CheckRun);
  });
}

function collectStatuses(pages: unknown[]): CommitStatus[] {
  return pages.flatMap((page) => {
    if (!Array.isArray(page)) {
      throw new Error("GitHub returned an invalid commit-status page");
    }
    return page.map((status) => asRecord(status) as CommitStatus);
  });
}

function classifyEvidence(checkRuns: CheckRun[], statuses: CommitStatus[]): EvidenceState {
  if (checkRuns.length === 0 && statuses.length === 0) return "absent";
  if (checkRuns.some((checkRun) => checkRun.status !== "completed") || statuses.some((status) => status.state === "pending")) {
    return "pending";
  }
  if (checkRuns.some((checkRun) => checkRun.conclusion !== "success") || statuses.some((status) => status.state !== "success")) {
    return "failed/cancelled";
  }
  return "passed";
}

export async function acquireReviewGateEvidence(
  owner: string,
  repo: string,
  headSha: string,
  getPages: EvidencePages,
): Promise<ReviewGateEvidence> {
  const checkRunsPath = `/repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100`;
  const statusesPath = `/repos/${owner}/${repo}/commits/${headSha}/statuses?per_page=100`;
  const [checkRunPages, statusPages] = await Promise.all([getPages(checkRunsPath), getPages(statusesPath)]);
  const checkRuns = collectCheckRuns(checkRunPages).filter((checkRun) => checkRun.head_sha === headSha);
  const statuses = collectStatuses(statusPages).filter((status) => status.sha === undefined || status.sha === headSha);
  return {
    head_sha: headSha,
    state: classifyEvidence(checkRuns, statuses),
    check_runs: checkRuns,
    statuses,
  };
}

function getPagesWithGh(endpoint: string): Promise<unknown[]> {
  const result = spawnSync("gh", ["api", "--paginate", "--slurp", endpoint], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `gh api exited with status ${result.status}`);
  }
  const pages: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(pages)) throw new Error("gh api --slurp returned a non-array response");
  return Promise.resolve(pages);
}

async function main(args: string[]): Promise<void> {
  const [owner, repo, headSha, ...extra] = args;
  if (!owner || !repo || !headSha || extra.length > 0 || !/^[0-9a-f]{40}$/i.test(headSha)) {
    throw new Error("Usage: bun tooling/review-gate-evidence.ts <owner> <repo> <40-character-head-sha>");
  }
  const evidence = await acquireReviewGateEvidence(owner, repo, headSha, getPagesWithGh);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
