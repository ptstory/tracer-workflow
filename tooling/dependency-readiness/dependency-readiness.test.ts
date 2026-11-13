import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  parseDependencies,
  reconcileAllDependencies,
  reconcileDependents,
  reconcileIssue,
  type DependencyReadinessApi,
} from "./dependency-readiness";

const workflow = readFileSync(new URL("../../.github/workflows/dependency-readiness.yml", import.meta.url), "utf8");

type FixtureIssue = {
  number: number;
  state: "open" | "closed";
  body: string | null;
  labels: Array<{ name: string }>;
  pull_request?: unknown;
};

class FixtureApi implements DependencyReadinessApi {
  issues = new Map<number, FixtureIssue>();
  comments = new Map<number, Array<{ body: string }>>();
  calls: string[] = [];
  labels = ["ready-for-agent"];

  getIssue(issueNumber: number): FixtureIssue {
    const issue = this.issues.get(issueNumber);
    if (!issue) throw new Error(`missing fixture issue #${issueNumber}`);
    this.calls.push(`get:${issueNumber}`);
    return issue;
  }

  listOpenIssues(): FixtureIssue[] {
    return [...this.issues.values()].filter(({ state }) => state === "open");
  }

  listRepositoryLabels(): string[] {
    return this.labels;
  }

  createRepositoryLabel(name: string): void {
    this.calls.push(`create-label:${name}`);
    this.labels.push(name);
  }

  addIssueLabel(issueNumber: number, label: string): void {
    this.calls.push(`add:${issueNumber}:${label}`);
    const issue = this.getFixture(issueNumber);
    if (!issue.labels.some((item) => item.name === label)) issue.labels.push({ name: label });
  }

  removeIssueLabel(issueNumber: number, label: string): void {
    this.calls.push(`remove:${issueNumber}:${label}`);
    const issue = this.getFixture(issueNumber);
    issue.labels = issue.labels.filter((item) => item.name !== label);
  }

  listIssueComments(issueNumber: number): Array<{ body: string }> {
    this.calls.push(`comments:${issueNumber}`);
    return this.comments.get(issueNumber) ?? [];
  }

  createIssueComment(issueNumber: number, body: string): void {
    this.calls.push(`comment:${issueNumber}`);
    const comments = this.comments.get(issueNumber) ?? [];
    comments.push({ body });
    this.comments.set(issueNumber, comments);
  }

  private getFixture(issueNumber: number): FixtureIssue {
    const issue = this.issues.get(issueNumber);
    if (!issue) throw new Error(`missing fixture issue #${issueNumber}`);
    return issue;
  }
}

function fixtureIssue(
  number: number,
  body: string | null,
  state: "open" | "closed" = "open",
  labels: string[] = [],
  pullRequest = false,
): FixtureIssue {
  return {
    number,
    state,
    body,
    labels: labels.map((name) => ({ name })),
    ...(pullRequest ? { pull_request: { url: `https://api.github.com/repos/acme/repo/pulls/${number}` } } : {}),
  };
}

describe("dependency readiness workflow", () => {
  test("reconciles issue edits and label events, plus issue and PR closures", () => {
    expect(workflow).toContain("issues:");
    expect(workflow).toContain("types: [opened, edited, labeled, closed, reopened]");
    expect(workflow).toContain("group: dependency-readiness-${{ github.repository }}");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("pull_request_target:");
    expect(workflow).toContain("types: [closed, reopened]");
    expect(workflow).toContain("uses: actions/checkout@v4");
    expect(workflow).toContain("bun tooling/dependency-readiness/dependency-readiness.ts");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("issues: write");
  });
});

describe("dependency reference parsing", () => {
  test("parses a single dependency reference", () => {
    expect(parseDependencies("Goal\nDepends on #12\nMore detail")).toEqual([12]);
  });

  test("parses multiple dependency references", () => {
    expect(parseDependencies("Depends on #12 #13, #14")).toEqual([12, 13, 14]);
  });

  test("blocks readiness for an open self-reference", () => {
    const api = new FixtureApi();
    api.issues.set(17, fixtureIssue(17, "Depends on #17", "open", ["ready-for-agent"]));

    reconcileIssue(17, api);

    expect(api.issues.get(17)?.labels.map(({ name }) => name)).toEqual(["blocked"]);
    expect(api.comments.get(17)?.[0]?.body).toContain("#17");
  });

  test("parses a PR reference as a same-repository number", () => {
    const api = new FixtureApi();
    api.issues.set(15, fixtureIssue(15, "", "closed", [], true));
    api.issues.set(16, fixtureIssue(16, "Depends on #15", "open", ["blocked"]));

    reconcileIssue(16, api);

    expect(api.issues.get(16)?.labels.map(({ name }) => name)).toEqual(["ready-for-agent"]);
    expect(api.comments.get(16)?.[0]?.body).toContain("All dependencies are closed: #15");
  });

  test("ignores missing and non-exact dependency lines", () => {
    expect(parseDependencies("See #12\nDepends on #12 in another repo\n depends on #13")).toEqual([]);
  });
});

describe("dependency readiness reconciliation", () => {
  test("blocks readiness and names every open dependency", () => {
    const api = new FixtureApi();
    api.issues.set(10, fixtureIssue(10, "Depends on #11, #12", "open", ["ready-for-agent"]));
    api.issues.set(11, fixtureIssue(11, "", "open"));
    api.issues.set(12, fixtureIssue(12, "", "closed"));

    reconcileIssue(10, api);

    expect(api.issues.get(10)?.labels.map(({ name }) => name)).toEqual(["blocked"]);
    expect(api.comments.get(10)?.[0]?.body).toContain("#11");
    expect(api.comments.get(10)?.[0]?.body).not.toContain("#12");
    expect(api.labels).toContain("blocked");
  });

  test("restores each dependent after an issue or PR dependency closes", () => {
    const api = new FixtureApi();
    api.issues.set(20, fixtureIssue(20, "Depends on #22", "open", ["blocked"]));
    api.issues.set(21, fixtureIssue(21, "Depends on #22", "open", ["blocked"]));
    api.issues.set(22, fixtureIssue(22, "", "closed"));
    api.comments.set(20, [{ body: "<!-- tracer-dependency-readiness:blocked -->\nPrevious blocked state" }]);
    api.comments.set(21, [{ body: "<!-- tracer-dependency-readiness:blocked -->\nPrevious blocked state" }]);

    reconcileDependents(22, api);

    for (const issueNumber of [20, 21]) {
      expect(api.issues.get(issueNumber)?.labels.map(({ name }) => name)).toEqual(["ready-for-agent"]);
      expect(api.comments.get(issueNumber)?.at(-1)?.body).toContain("All dependencies are closed: #22");
    }
  });

  test("removes readiness and adds blocked when dependency state cannot be read", () => {
    const api = new FixtureApi();
    api.issues.set(45, fixtureIssue(45, "Depends on #46", "open", ["ready-for-agent"]));

    expect(() => reconcileIssue(45, api)).toThrow("could not verify dependency #46");
    expect(api.issues.get(45)?.labels.map(({ name }) => name)).toEqual(["blocked"]);
    expect(api.comments.get(45)).toBeUndefined();
  });

  test("reconciles from current dependency state after competing events", () => {
    const api = new FixtureApi();
    api.issues.set(55, fixtureIssue(55, "Depends on #56", "open", ["blocked"]));
    api.issues.set(56, fixtureIssue(56, "", "closed"));

    reconcileAllDependencies(api);
    expect(api.issues.get(55)?.labels.map(({ name }) => name)).toEqual(["ready-for-agent"]);

    api.issues.get(56)!.state = "open";
    reconcileAllDependencies(api);
    expect(api.issues.get(55)?.labels.map(({ name }) => name)).toEqual(["blocked"]);
    expect(api.comments.get(55)?.at(-1)?.body).toContain("#56");

    api.issues.get(56)!.state = "closed";
    reconcileAllDependencies(api);
    expect(api.issues.get(55)?.labels.map(({ name }) => name)).toEqual(["ready-for-agent"]);
  });

  test("preserves readiness eligibility when dependencies resolve", () => {
    const api = new FixtureApi();
    api.issues.set(47, fixtureIssue(47, "Depends on #48", "open", ["ready-for-agent"]));
    api.issues.set(48, fixtureIssue(48, "", "closed"));

    reconcileIssue(47, api);

    expect(api.issues.get(47)?.labels.map(({ name }) => name)).toEqual(["ready-for-agent"]);
  });

  test("leaves an issue without an exact Depends on line untouched", () => {
    const api = new FixtureApi();
    api.issues.set(30, fixtureIssue(30, "Related to #31", "open", ["ready-for-agent"]));
    api.issues.set(31, fixtureIssue(31, "", "open"));

    reconcileIssue(30, api);

    expect(api.calls).toEqual(["get:30"]);
    expect(api.issues.get(30)?.labels.map(({ name }) => name)).toEqual(["ready-for-agent"]);
    expect(api.comments.get(30)).toBeUndefined();
  });

  test("does not duplicate a managed comment or label writes on replay", () => {
    const api = new FixtureApi();
    api.issues.set(40, fixtureIssue(40, "Depends on #41", "open", ["blocked"]));
    api.issues.set(41, fixtureIssue(41, "", "open"));

    reconcileIssue(40, api);
    const callCount = api.calls.length;
    reconcileIssue(40, api);

    expect(api.comments.get(40)).toHaveLength(1);
    expect(api.calls.slice(callCount)).toEqual(["get:40", "get:41", "comments:40"]);
  });

  test("fails before changing readiness when a dependency cannot be resolved", () => {
    const api = new FixtureApi();
    api.issues.set(50, fixtureIssue(50, "Depends on #51", "open", ["ready-for-agent"]));

    expect(() => reconcileIssue(50, api)).toThrow("could not verify dependency #51");
    expect(api.issues.get(50)?.labels.map(({ name }) => name)).toEqual(["blocked"]);
    expect(api.comments.get(50)).toBeUndefined();
  });
});
