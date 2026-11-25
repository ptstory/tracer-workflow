import { describe, expect, test } from "bun:test";

import {
  applyMigration,
  buildMigrationPlan,
  parseBlockedByDeclaration,
  type NativeDependency,
  type NativeDependencyApi,
  type NativeIssue,
} from "./native-dependencies";

class FixtureApi implements NativeDependencyApi {
  issues = new Map<number, NativeIssue>();
  blockedBy = new Map<number, NativeDependency[]>();
  calls: string[] = [];
  failVerification = new Set<number>();

  listIssues(): NativeIssue[] {
    return [...this.issues.values()];
  }

  listBlockedBy(issueNumber: number): NativeDependency[] {
    this.calls.push(`blocked-by:${issueNumber}`);
    if (this.failVerification.has(issueNumber) && this.calls.filter((call) => call === `blocked-by:${issueNumber}`).length > 1) {
      throw new Error("readback unavailable");
    }
    return this.blockedBy.get(issueNumber) ?? [];
  }

  listBlocking(issueNumber: number): NativeDependency[] {
    this.calls.push(`blocking:${issueNumber}`);
    return [];
  }

  createBlockedBy(issueNumber: number, blockerId: number): void {
    this.calls.push(`create:${issueNumber}:${blockerId}`);
    const blocker = [...this.issues.values()].find(({ id }) => id === blockerId);
    if (!blocker) throw new Error(`missing fixture issue id ${blockerId}`);
    const edges = this.blockedBy.get(issueNumber) ?? [];
    if (!edges.some(({ number }) => number === blocker.number)) {
      edges.push({ id: blocker.id, number: blocker.number, repository: blocker.repository, state: blocker.state });
      this.blockedBy.set(issueNumber, edges);
    }
  }

  removeIssueLabel(issueNumber: number, label: string): void {
    this.calls.push(`remove-label:${issueNumber}:${label}`);
    const issue = this.issues.get(issueNumber)!;
    issue.labels = issue.labels.filter((item) => item !== label);
  }
}

function issue(number: number, body: string | null, options: {
  state?: "open" | "closed";
  labels?: string[];
  repository?: string;
} = {}): NativeIssue {
  return {
    id: number * 100,
    number,
    repository: options.repository ?? "acme/repo",
    state: options.state ?? "open",
    body,
    labels: options.labels ?? [],
    pullRequest: false,
  };
}

function fixture(...issues: NativeIssue[]): FixtureApi {
  const api = new FixtureApi();
  for (const item of issues) api.issues.set(item.number, item);
  return api;
}

describe("Blocked by declaration parser", () => {
  test("parses one blocker and allows trailing explanation", () => {
    expect(parseBlockedByDeclaration("## Blocked by\n\n- #12 — consumes the API contract\n\n## Notes", "acme/repo"))
      .toEqual({ status: "declared", blockers: [12], diagnostics: [] });
  });

  test("parses multiple blockers from separate bullets", () => {
    expect(parseBlockedByDeclaration("## Blocked by\n- #12\n- #13", "acme/repo"))
      .toEqual({ status: "declared", blockers: [12, 13], diagnostics: [] });
  });

  test("treats explicit None as no dependency", () => {
    expect(parseBlockedByDeclaration("## Blocked by\nNone - can start immediately", "acme/repo"))
      .toEqual({ status: "none", blockers: [], diagnostics: [] });
  });

  test("reports missing, ambiguous, duplicate, and cross-repository targets", () => {
    expect(parseBlockedByDeclaration("No dependency section", "acme/repo").status).toBe("missing");
    expect(parseBlockedByDeclaration("## Blocked by\n- #12 and #13", "acme/repo").diagnostics[0])
      .toContain("multiple issue references");
    expect(parseBlockedByDeclaration("## Blocked by\n#12", "acme/repo").diagnostics[0])
      .toContain("free prose");
    expect(parseBlockedByDeclaration("## Blocked by\n- other/repo#12", "acme/repo").diagnostics[0])
      .toContain("cross-repository");
  });
});

describe("native dependency migration", () => {
  test("plans one missing edge without mutating and preserves an existing edge", async () => {
    const api = fixture(issue(1, "## Blocked by\n- #2"), issue(2, null));
    api.blockedBy.set(1, [{ id: 200, number: 2, repository: "acme/repo", state: "open" }]);
    const plan = await buildMigrationPlan("acme/repo", api);
    expect(plan.rows[0]?.missingBlockers).toEqual([]);
    expect(plan.rows[0]?.preservedBlockers.map(({ number }) => number)).toEqual([2]);
    expect(api.calls.filter((call) => call.startsWith("create:")).length).toBe(0);
  });

  test("reports a missing target and skips its mutation", async () => {
    const api = fixture(issue(1, "## Blocked by\n- #99"));
    const plan = await buildMigrationPlan("acme/repo", api);
    expect(plan.rows[0]?.diagnostics).toContain("missing target #99");
    applyMigration(plan, api, { removeBlockedLabels: false });
    expect(api.calls.some((call) => call.startsWith("create:"))).toBe(false);
  });

  test("detects proposed cycles before applying either edge", async () => {
    const api = fixture(
      issue(1, "## Blocked by\n- #2"),
      issue(2, "## Blocked by\n- #1"),
    );
    const plan = await buildMigrationPlan("acme/repo", api);
    expect(plan.rows.every(({ diagnostics }) => diagnostics.some((item) => item.includes("cycle")))).toBe(true);
    applyMigration(plan, api, { removeBlockedLabels: false });
    expect(api.calls.some((call) => call.startsWith("create:"))).toBe(false);
  });

  test("preserves closed state when migrating a declared blocker and verifies before label cleanup", async () => {
    const api = fixture(
      issue(1, "## Blocked by\n- #2", { labels: ["blocked"] }),
      issue(2, null, { state: "closed" }),
    );
    const plan = await buildMigrationPlan("acme/repo", api);
    expect(plan.rows[0]?.missingBlockers).toEqual([2]);
    expect(plan.rows[0]?.cleanupEligibleAfterReadback).toBe(true);

    applyMigration(plan, api, { removeBlockedLabels: true });

    expect(plan.rows[0]?.verified).toBe(true);
    expect(api.blockedBy.get(1)?.[0]?.state).toBe("closed");
    expect(api.issues.get(1)?.labels).toEqual([]);
  });

  test("creates missing edges, verifies readback, removes labels only when explicitly opted in, and reruns idempotently", async () => {
    const api = fixture(issue(1, "## Blocked by\n- #2\n- #3", { labels: ["blocked"] }), issue(2, null), issue(3, null));
    const plan = await buildMigrationPlan("acme/repo", api);
    expect(plan.rows[0]?.missingBlockers).toEqual([2, 3]);
    expect(plan.rows[0]?.cleanupEligibleAfterReadback).toBe(true);
    applyMigration(plan, api, { removeBlockedLabels: true });
    expect(plan.rows[0]?.verified).toBe(true);
    expect(plan.rows[0]?.writes).toEqual([2, 3]);
    expect(api.issues.get(1)?.labels).toEqual([]);

    const rerun = await buildMigrationPlan("acme/repo", api);
    applyMigration(rerun, api, { removeBlockedLabels: true });
    expect(rerun.rows[0]?.missingBlockers).toEqual([]);
    expect(api.calls.filter((call) => call.startsWith("create:"))).toHaveLength(2);
  });

  test("retains the blocked label when native readback fails", async () => {
    const api = fixture(issue(1, "## Blocked by\n- #2", { labels: ["blocked"] }), issue(2, null));
    api.failVerification.add(1);
    const plan = await buildMigrationPlan("acme/repo", api);
    applyMigration(plan, api, { removeBlockedLabels: true });
    expect(plan.rows[0]?.verified).toBe(false);
    expect(api.issues.get(1)?.labels).toEqual(["blocked"]);
  });
});
