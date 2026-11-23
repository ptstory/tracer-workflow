import { describe, expect, test } from "bun:test";
import { acquireReviewGateEvidence } from "./review-gate-evidence";

const reviewedHeadSha = "68109ff6d980ff035beee9b40a4e9058ec01d41d";
const otherHeadSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const repoOwner = "ptstory";
const corbyRepository = "corby-server-scraper";

function makePageSource(checkRuns: unknown[], statuses: unknown[] = []) {
  const requests: string[] = [];
  const getPages = async (endpoint: string): Promise<unknown[]> => {
    requests.push(endpoint);
    if (endpoint.includes("/check-runs?")) return [{ check_runs: checkRuns }];
    if (endpoint.includes("/statuses?")) return [statuses];
    throw new Error(`Unexpected evidence endpoint: ${endpoint}`);
  };
  return { getPages, requests };
}

describe("Review Gate exact-head evidence acquisition", () => {
  test("discovers the failed Corby push-only run on the reviewed SHA", async () => {
    const { getPages, requests } = makePageSource([
      {
        id: 16,
        name: "inkode.yml",
        head_sha: reviewedHeadSha,
        event: "push",
        status: "completed",
        conclusion: "failure",
      },
    ]);

    const evidence = await acquireReviewGateEvidence(repoOwner, corbyRepository, reviewedHeadSha, getPages);

    expect(requests).toEqual([
      `/repos/${repoOwner}/${corbyRepository}/commits/${reviewedHeadSha}/check-runs?per_page=100`,
      `/repos/${repoOwner}/${corbyRepository}/commits/${reviewedHeadSha}/statuses?per_page=100`,
    ]);
    expect(evidence.head_sha).toBe(reviewedHeadSha);
    expect(evidence.check_runs.map((checkRun) => checkRun.event)).toEqual(["push"]);
    expect(evidence.state).toBe("failed/cancelled");
    expect(evidence.state).not.toBe("absent");
  });

  test("uses the latest same-name check attempt on the reviewed SHA", async () => {
    const { getPages } = makePageSource([
      {
        id: 10,
        name: "test",
        app: { slug: "github-actions" },
        run_number: 4,
        run_attempt: 1,
        run_started_at: "2026-11-01T00:00:00Z",
        head_sha: reviewedHeadSha,
        event: "push",
        status: "completed",
        conclusion: "failure",
      },
      {
        id: 11,
        name: "test",
        app: { slug: "github-actions" },
        run_number: 4,
        run_attempt: 2,
        run_started_at: "2026-11-01T00:00:00Z",
        head_sha: reviewedHeadSha,
        event: "push",
        status: "completed",
        conclusion: "success",
      },
    ], [
      { context: "ci", state: "failure", sha: reviewedHeadSha, created_at: "2026-11-01T00:00:00Z" },
      { context: "ci", state: "success", sha: reviewedHeadSha, created_at: "2026-11-01T00:01:00Z" },
    ]);

    const evidence = await acquireReviewGateEvidence(repoOwner, "tracer-workflow", reviewedHeadSha, getPages);

    expect(evidence.check_runs.map((checkRun) => checkRun.id)).toEqual([11]);
    expect(evidence.statuses.map((status) => status.state)).toEqual(["success"]);
    expect(evidence.state).toBe("passed");
  });

  test("keeps same-name check runs from distinct apps separate", async () => {
    const { getPages } = makePageSource([
      {
        id: 12,
        name: "build",
        app: { slug: "first-app" },
        head_sha: reviewedHeadSha,
        status: "completed",
        conclusion: "success",
      },
      {
        id: 13,
        name: "build",
        app: { slug: "second-app" },
        head_sha: reviewedHeadSha,
        status: "completed",
        conclusion: "success",
      },
    ]);

    const evidence = await acquireReviewGateEvidence(repoOwner, "tracer-workflow", reviewedHeadSha, getPages);

    expect(evidence.check_runs.map((checkRun) => checkRun.id)).toEqual([12, 13]);
    expect(evidence.state).toBe("passed");
  });

  test("ignores check runs returned for another SHA", async () => {
    const { getPages } = makePageSource([
      { head_sha: otherHeadSha, event: "push", status: "completed", conclusion: "failure" },
    ]);

    const evidence = await acquireReviewGateEvidence(repoOwner, "tracer-workflow", reviewedHeadSha, getPages);

    expect(evidence.check_runs).toEqual([]);
    expect(evidence.state).toBe("absent");
  });

  test("continues to include pull-request-triggered runs", async () => {
    const { getPages } = makePageSource([
      { head_sha: reviewedHeadSha, event: "pull_request", status: "completed", conclusion: "success" },
    ]);

    const evidence = await acquireReviewGateEvidence(repoOwner, "tracer-workflow", reviewedHeadSha, getPages);

    expect(evidence.check_runs).toHaveLength(1);
    expect(evidence.state).toBe("passed");
  });

  test.each([
    ["pending", { head_sha: reviewedHeadSha, status: "in_progress", conclusion: null }, "pending"],
    ["successful", { head_sha: reviewedHeadSha, status: "completed", conclusion: "success" }, "passed"],
  ] as const)("classifies exact-head %s check evidence", async (_label, checkRun, expected) => {
    const { getPages } = makePageSource([checkRun]);

    const evidence = await acquireReviewGateEvidence(repoOwner, "tracer-workflow", reviewedHeadSha, getPages);

    expect(evidence.state).toBe(expected);
  });
});
