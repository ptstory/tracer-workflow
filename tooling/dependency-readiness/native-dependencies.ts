import { spawnSync } from "node:child_process";

type IssueState = "open" | "closed";

export type NativeIssue = {
  id: number;
  number: number;
  repository: string;
  state: IssueState;
  body: string | null;
  labels: string[];
  pullRequest: boolean;
};

export type NativeDependency = {
  id: number;
  number: number;
  repository: string;
  state: IssueState;
};

export type DependencyDeclaration = {
  status: "missing" | "invalid" | "none" | "declared";
  blockers: number[];
  diagnostics: string[];
};

export type MigrationRow = {
  issue: NativeIssue;
  declaration: DependencyDeclaration;
  existingBlockers: NativeDependency[];
  missingBlockers: number[];
  preservedBlockers: NativeDependency[];
  diagnostics: string[];
  legacyBlockedLabel: boolean;
  cleanupEligibleAfterReadback: boolean;
  writes: number[];
  verified: boolean | null;
  labelRemoved: boolean;
};

export type MigrationPlan = {
  repository: string;
  rows: MigrationRow[];
};

export interface NativeDependencyApi {
  listIssues(state: "open" | "all"): NativeIssue[];
  listBlockedBy(issueNumber: number): NativeDependency[];
  listBlocking(issueNumber: number): NativeDependency[];
  createBlockedBy(issueNumber: number, blockerId: number): void;
  removeIssueLabel(issueNumber: number, label: string): void;
}

const BLOCKED_LABEL = "blocked";
const MAX_PAGE_COUNT = 100;

export function parseBlockedByDeclaration(
  body: string | null | undefined,
  repository: string,
): DependencyDeclaration {
  if (!body) return { status: "missing", blockers: [], diagnostics: [] };

  const lines = body.split(/\r?\n/);
  const headings = lines.flatMap((line, index) => line === "## Blocked by" ? [index] : []);
  if (headings.length === 0) return { status: "missing", blockers: [], diagnostics: [] };
  if (headings.length > 1) {
    return { status: "invalid", blockers: [], diagnostics: ["multiple exact ## Blocked by sections"] };
  }

  const sectionLines: string[] = [];
  for (const line of lines.slice(headings[0] + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    sectionLines.push(line);
  }

  const content = sectionLines.map((line) => line.trim()).filter(Boolean);
  if (content.length === 0) {
    return { status: "invalid", blockers: [], diagnostics: ["Blocked by section is empty"] };
  }

  if (content.length === 1 && /^(?:-\s*)?(?:none|no dependencies?)(?:\s+[-:].*)?$/i.test(content[0]) && !hasIssueReference(content[0])) {
    return { status: "none", blockers: [], diagnostics: [] };
  }

  const blockers: number[] = [];
  const diagnostics: string[] = [];
  for (const line of sectionLines) {
    if (!line.trim()) continue;

    const references = issueReferences(line);
    if (!line.startsWith("- ")) {
      diagnostics.push(references.length > 0
        ? `issue reference in free prose: ${line.trim()}`
        : `unrecognized declaration line: ${line.trim()}`);
      continue;
    }

    const match = line.match(/^- #(\d+)(?=$|\s)(.*)$/);
    if (!match) {
      const crossRepository = qualifiedIssueReferences(line).find(({ repository: target }) => target !== repository);
      diagnostics.push(crossRepository
        ? `cross-repository target ${crossRepository.repository}#${crossRepository.number}`
        : `malformed dependency bullet: ${line.trim()}`);
      continue;
    }

    const issueNumber = Number(match[1]);
    if (references.length > 1) {
      diagnostics.push(`ambiguous dependency bullet with multiple issue references: ${line.trim()}`);
      continue;
    }

    const qualified = qualifiedIssueReferences(line);
    if (qualified.some(({ repository: target }) => target !== repository)) {
      const target = qualified.find(({ repository: targetRepository }) => targetRepository !== repository)!;
      diagnostics.push(`cross-repository target ${target.repository}#${target.number}`);
      continue;
    }
    if (blockers.includes(issueNumber)) {
      diagnostics.push(`duplicate dependency target #${issueNumber}`);
      continue;
    }
    blockers.push(issueNumber);
  }

  return {
    status: diagnostics.length > 0 ? "invalid" : "declared",
    blockers,
    diagnostics,
  };
}

export async function buildMigrationPlan(
  repository: string,
  api: NativeDependencyApi,
): Promise<MigrationPlan> {
  const allIssues = api.listIssues("all");
  const issueByNumber = new Map(allIssues.map((issue) => [issue.number, issue]));
  const graph = new Map<string, Set<string>>();
  const existingByNumber = new Map<number, NativeDependency[]>();

  for (const issue of allIssues) {
    const existing = api.listBlockedBy(issue.number);
    existingByNumber.set(issue.number, existing);
    const dependentKey = issueKey(issue.repository, issue.number);
    for (const blocker of existing) addEdge(graph, dependentKey, issueKey(blocker.repository, blocker.number));
  }

  const rows: MigrationRow[] = [];
  for (const issue of allIssues.filter(({ state, pullRequest }) => state === "open" && !pullRequest)) {
    const declaration = parseBlockedByDeclaration(issue.body, repository);
    if (declaration.status === "missing") continue;

    const existingBlockers = existingByNumber.get(issue.number) ?? [];
    const declaredSet = new Set(declaration.blockers);
    const preservedBlockers = existingBlockers.filter((blocker) =>
      blocker.repository === repository && declaredSet.has(blocker.number)
    );
    const diagnostics = [...declaration.diagnostics];
    const missingBlockers: number[] = [];

    if (declaration.status === "declared") {
      for (const blockerNumber of declaration.blockers) {
        const target = issueByNumber.get(blockerNumber);
        if (!target) {
          diagnostics.push(`missing target #${blockerNumber}`);
          continue;
        }
        if (target.repository !== repository) {
          diagnostics.push(`cross-repository target ${target.repository}#${blockerNumber}`);
          continue;
        }
        if (!existingBlockers.some(({ repository: targetRepository, number }) =>
          targetRepository === repository && number === blockerNumber
        )) {
          missingBlockers.push(blockerNumber);
        }
      }
    }

    rows.push({
      issue,
      declaration,
      existingBlockers,
      missingBlockers,
      preservedBlockers,
      diagnostics,
      legacyBlockedLabel: issue.labels.includes(BLOCKED_LABEL),
      cleanupEligibleAfterReadback: issue.labels.includes(BLOCKED_LABEL) &&
        declaration.status !== "invalid" && diagnostics.length === 0,
      writes: [],
      verified: null,
      labelRemoved: false,
    });
  }

  for (const row of rows) {
    if (row.diagnostics.length > 0 || row.declaration.status !== "declared") continue;
    for (const blockerNumber of row.declaration.blockers) {
      addEdge(graph, issueKey(repository, row.issue.number), issueKey(repository, blockerNumber));
    }
  }

  for (const row of rows) {
    if (row.diagnostics.length > 0 || row.declaration.status !== "declared") continue;
    const dependentKey = issueKey(repository, row.issue.number);
    const cyclic = row.missingBlockers.find((blockerNumber) =>
      hasPath(graph, issueKey(repository, blockerNumber), dependentKey)
    );
    if (cyclic !== undefined) {
      row.diagnostics.push(`dependency cycle involving #${row.issue.number} and #${cyclic}`);
      row.cleanupEligibleAfterReadback = false;
    }
  }

  return { repository, rows };
}

export function applyMigration(
  plan: MigrationPlan,
  api: NativeDependencyApi,
  options: { removeBlockedLabels: boolean },
): void {
  const issueByNumber = new Map(api.listIssues("all").map((issue) => [issue.number, issue]));
  for (const row of plan.rows) {
    if (row.diagnostics.length > 0 || !row.cleanupEligibleAfterReadback && row.legacyBlockedLabel) continue;
    if (row.declaration.status !== "declared" && row.declaration.status !== "none") continue;

    let createFailed = false;
    for (const blockerNumber of row.missingBlockers) {
      const blocker = issueByNumber.get(blockerNumber);
      if (!blocker) {
        createFailed = true;
        row.diagnostics.push(`missing target #${blockerNumber} before write`);
        continue;
      }
      try {
        api.createBlockedBy(row.issue.number, blocker.id);
        row.writes.push(blockerNumber);
      } catch (error) {
        createFailed = true;
        row.diagnostics.push(`could not create native edge to #${blockerNumber}: ${errorMessage(error)}`);
      }
    }

    try {
      const afterWrite = api.listBlockedBy(row.issue.number);
      const intended = row.declaration.blockers.every((blockerNumber) =>
        afterWrite.some(({ repository, number }) => repository === plan.repository && number === blockerNumber)
      );
      row.verified = intended;
      if (!intended) row.diagnostics.push("native dependency readback did not contain every declared blocker");
      if (options.removeBlockedLabels && !createFailed && intended && row.cleanupEligibleAfterReadback && row.legacyBlockedLabel) {
        api.removeIssueLabel(row.issue.number, BLOCKED_LABEL);
        row.labelRemoved = true;
      }
    } catch (error) {
      row.verified = false;
      row.diagnostics.push(`could not verify native dependencies: ${errorMessage(error)}`);
    }
  }
}

export class GitHubNativeDependencyApi implements NativeDependencyApi {
  constructor(readonly repository: string) {}

  listIssues(state: "open" | "all"): NativeIssue[] {
    return listPages<unknown>((page) =>
      `repos/${this.repository}/issues?state=${state}&per_page=100&page=${page}`
    ).map((value) => parseIssue(value, this.repository)).filter((issue) => !issue.pullRequest);
  }

  listBlockedBy(issueNumber: number): NativeDependency[] {
    return listPages<unknown>((page) =>
      `repos/${this.repository}/issues/${issueNumber}/dependencies/blocked_by?per_page=100&page=${page}`
    ).map((value) => parseDependency(value, this.repository));
  }

  listBlocking(issueNumber: number): NativeDependency[] {
    return listPages<unknown>((page) =>
      `repos/${this.repository}/issues/${issueNumber}/dependencies/blocking?per_page=100&page=${page}`
    ).map((value) => parseDependency(value, this.repository));
  }

  createBlockedBy(issueNumber: number, blockerId: number): void {
    runGh([
      "--method", "POST", `repos/${this.repository}/issues/${issueNumber}/dependencies/blocked_by`,
      "-F", `issue_id=${blockerId}`,
    ]);
  }

  removeIssueLabel(issueNumber: number, label: string): void {
    runGh(["--method", "DELETE", `repos/${this.repository}/issues/${issueNumber}/labels/${label}`]);
  }
}

function issueReferences(value: string): Array<{ repository?: string; number: number }> {
  const references: Array<{ repository?: string; number: number }> = [];
  const pattern = /([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)|https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/(\d+)|#(\d+)/g;
  for (const match of value.matchAll(pattern)) {
    if (match[1]) references.push({ repository: match[1], number: Number(match[2]) });
    else if (match[3]) references.push({ repository: match[3], number: Number(match[4]) });
    else references.push({ number: Number(match[5]) });
  }
  return references;
}

function qualifiedIssueReferences(value: string): Array<{ repository: string; number: number }> {
  return issueReferences(value).filter((reference): reference is { repository: string; number: number } =>
    reference.repository !== undefined
  );
}

function hasIssueReference(value: string): boolean {
  return issueReferences(value).length > 0;
}

function issueKey(repository: string, issueNumber: number): string {
  return `${repository}#${issueNumber}`;
}

function addEdge(graph: Map<string, Set<string>>, from: string, to: string): void {
  const edges = graph.get(from) ?? new Set<string>();
  edges.add(to);
  graph.set(from, edges);
}

function hasPath(graph: Map<string, Set<string>>, start: string, target: string): boolean {
  const visited = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(graph.get(current) ?? []));
  }
  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "GitHub request failed";
}

function runGh(args: string[]): string {
  const result = spawnSync("gh", ["api", ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`native-dependencies: gh api ${args[0]} failed (exit ${result.status ?? "unknown"})`);
  }
  return result.stdout;
}

function requestJson<T>(args: string[]): T {
  try {
    return JSON.parse(runGh(args)) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`native-dependencies: invalid JSON from gh api ${args[0]}`);
    }
    throw error;
  }
}

function listPages<T>(route: (page: number) => string): T[] {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGE_COUNT; page += 1) {
    const batch = requestJson<T[]>([route(page)]);
    if (!Array.isArray(batch)) throw new Error("native-dependencies: expected a paginated list");
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error("native-dependencies: pagination limit exceeded");
}

function parseIssue(value: unknown, fallbackRepository: string): NativeIssue {
  if (!value || typeof value !== "object") throw new Error("native-dependencies: invalid issue response");
  const issue = value as Record<string, unknown>;
  if (
    !Number.isInteger(issue.id) ||
    !Number.isInteger(issue.number) ||
    (issue.state !== "open" && issue.state !== "closed") ||
    (issue.body !== null && typeof issue.body !== "string") ||
    !Array.isArray(issue.labels)
  ) {
    throw new Error("native-dependencies: invalid issue response");
  }
  return {
    id: issue.id as number,
    number: issue.number as number,
    repository: repositoryFromUrl(issue.repository_url) ?? fallbackRepository,
    state: issue.state,
    body: issue.body,
    labels: (issue.labels as Array<{ name?: unknown }>).map(({ name }) => {
      if (typeof name !== "string") throw new Error("native-dependencies: invalid issue label");
      return name;
    }),
    pullRequest: Boolean(issue.pull_request),
  };
}

function parseDependency(value: unknown, fallbackRepository: string): NativeDependency {
  if (!value || typeof value !== "object") throw new Error("native-dependencies: invalid dependency response");
  const dependency = value as Record<string, unknown>;
  if (
    !Number.isInteger(dependency.id) ||
    !Number.isInteger(dependency.number) ||
    (dependency.state !== "open" && dependency.state !== "closed")
  ) {
    throw new Error("native-dependencies: invalid dependency response");
  }
  return {
    id: dependency.id as number,
    number: dependency.number as number,
    repository: repositoryFromUrl(dependency.repository_url) ?? fallbackRepository,
    state: dependency.state,
  };
}

function repositoryFromUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)$/);
  return match?.[1];
}

function outputRow(row: MigrationRow): Record<string, unknown> {
  return {
    issue: row.issue.number,
    declaration: row.declaration.status,
    declaredBlockers: row.declaration.blockers,
    existingNativeBlockers: row.existingBlockers.map(({ number, repository, state }) => ({ number, repository, state })),
    missingNativeEdges: row.missingBlockers,
    preservedNativeEdges: row.preservedBlockers.map(({ number, repository, state }) => ({ number, repository, state })),
    diagnostics: row.diagnostics,
    legacyBlockedLabel: row.legacyBlockedLabel,
    cleanupEligibleAfterVerifiedReadback: row.cleanupEligibleAfterReadback,
    appliedWrites: row.writes,
    verified: row.verified,
    labelRemoved: row.labelRemoved,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repoIndex = args.indexOf("--repo");
  const repository = repoIndex >= 0 ? args[repoIndex + 1] : process.env.GITHUB_REPOSITORY;
  const apply = args.includes("--apply");
  const removeBlockedLabels = args.includes("--remove-blocked-labels");
  const validArgs = args.every((arg, index) =>
    ["--apply", "--remove-blocked-labels"].includes(arg) || arg === "--repo" ||
    (index === repoIndex + 1 && repoIndex >= 0)
  );
  if (!validArgs || !repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error("usage: bun tooling/dependency-readiness/native-dependencies.ts [--repo owner/name] [--apply] [--remove-blocked-labels]");
  }
  if (removeBlockedLabels && !apply) throw new Error("--remove-blocked-labels requires --apply");

  const api = new GitHubNativeDependencyApi(repository);
  const plan = await buildMigrationPlan(repository, api);
  if (apply) applyMigration(plan, api, { removeBlockedLabels });
  process.stdout.write(`${JSON.stringify({
    repository,
    mode: apply ? "apply" : "dry-run",
    labelCleanupEnabled: removeBlockedLabels,
    issueCount: plan.rows.length,
    rows: plan.rows.map(outputRow),
  }, null, 2)}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown failure";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
