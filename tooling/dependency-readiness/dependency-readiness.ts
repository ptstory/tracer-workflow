import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

type IssueState = "open" | "closed";

type DependencyIssue = {
  number: number;
  state: IssueState;
  body: string | null;
  labels: Array<{ name: string }>;
  pull_request?: unknown;
};

type IssueComment = {
  body: string;
};

export interface DependencyReadinessApi {
  getIssue(issueNumber: number): DependencyIssue;
  listOpenIssues(): DependencyIssue[];
  listRepositoryLabels(): string[];
  createRepositoryLabel(name: string): void;
  addIssueLabel(issueNumber: number, label: string): void;
  removeIssueLabel(issueNumber: number, label: string): void;
  listIssueComments(issueNumber: number): IssueComment[];
  createIssueComment(issueNumber: number, body: string): void;
}

const READY_LABEL = "ready-for-agent";
const BLOCKED_LABEL = "blocked";
const COMMENT_MARKER = "<!-- tracer-dependency-readiness:";
const MAX_PAGE_COUNT = 100;

export function parseDependencies(body: string | null | undefined): number[] {
  if (!body) return [];

  const dependencies = new Set<number>();
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^Depends on\s+(#\d+(?:(?:\s*,\s*|\s+)#\d+)*)\s*$/);
    if (!match) continue;

    for (const reference of match[1].matchAll(/#(\d+)/g)) {
      dependencies.add(Number(reference[1]));
    }
  }

  return [...dependencies];
}

export function reconcileIssue(issueNumber: number, api: DependencyReadinessApi): void {
  const issue = api.getIssue(issueNumber);
  reconcileTargets([issue], api);
}

export function reconcileDependents(dependencyNumber: number, api: DependencyReadinessApi): void {
  const dependents = api.listOpenIssues().filter((issue) =>
    !issue.pull_request && parseDependencies(issue.body).includes(dependencyNumber)
  );
  reconcileTargets(dependents, api);
}

function reconcileTargets(issues: DependencyIssue[], api: DependencyReadinessApi): void {
  const targets = issues.filter((issue) =>
    issue.state === "open" && !issue.pull_request && parseDependencies(issue.body).length > 0
  );
  if (targets.length === 0) return;

  const dependencyStates = new Map<number, DependencyIssue>();
  const dependenciesByIssue = new Map<number, number[]>();
  let plans: Array<{
    issue: DependencyIssue;
    dependencies: number[];
    openDependencies: number[];
    comments: IssueComment[];
  }>;
  try {
    for (const issue of targets) {
      const dependencies = parseDependencies(issue.body);
      if (dependencies.length === 0) continue;
      dependenciesByIssue.set(issue.number, dependencies);
      for (const dependencyNumber of dependencies) {
        if (!dependencyStates.has(dependencyNumber)) {
          try {
            dependencyStates.set(dependencyNumber, api.getIssue(dependencyNumber));
          } catch (error) {
            const detail = error instanceof Error ? error.message : "GitHub read failed";
            throw new Error(`could not verify dependency #${dependencyNumber} for issue #${issue.number}: ${detail}`);
          }
        }
      }
    }

    plans = targets.flatMap((issue) => {
      const dependencies = dependenciesByIssue.get(issue.number);
      if (!dependencies) return [];
      const openDependencies = dependencies.filter((dependencyNumber) =>
        dependencyStates.get(dependencyNumber)?.state === "open"
      );
      return [{
        issue,
        dependencies,
        openDependencies,
        comments: api.listIssueComments(issue.number),
      }];
    });
  } catch (error) {
    failClosedReadiness(targets, api);
    const detail = error instanceof Error ? error.message : "GitHub state could not be read";
    throw new Error(`dependency-readiness: ${detail}; readiness changes were withheld where possible`);
  }

  for (const plan of plans) {
    const latestManagedComment = [...plan.comments].reverse().find(({ body }) =>
      body.startsWith(COMMENT_MARKER)
    );
    const isBlocked = plan.openDependencies.length > 0;
    if (isBlocked) {
      if (hasLabel(plan.issue, READY_LABEL)) api.removeIssueLabel(plan.issue.number, READY_LABEL);
      if (!hasLabel(plan.issue, BLOCKED_LABEL)) {
        ensureBlockedLabel(api);
        api.addIssueLabel(plan.issue.number, BLOCKED_LABEL);
      }
    } else {
      if (!hasLabel(plan.issue, READY_LABEL)) api.addIssueLabel(plan.issue.number, READY_LABEL);
      if (hasLabel(plan.issue, BLOCKED_LABEL)) api.removeIssueLabel(plan.issue.number, BLOCKED_LABEL);
    }

    const comment = buildComment(plan.dependencies, plan.openDependencies);
    if (latestManagedComment?.body !== comment) {
      api.createIssueComment(plan.issue.number, comment);
    }
  }
}

function hasLabel(issue: DependencyIssue, label: string): boolean {
  return issue.labels.some((item) => item.name === label);
}

function failClosedReadiness(issues: DependencyIssue[], api: DependencyReadinessApi): void {
  for (const issue of issues) {
    if (!hasLabel(issue, READY_LABEL)) continue;
    try {
      api.removeIssueLabel(issue.number, READY_LABEL);
    } catch {
      continue;
    }
  }

  const blockedTargets = issues.filter((issue) => !hasLabel(issue, BLOCKED_LABEL));
  if (blockedTargets.length === 0) return;
  try {
    ensureBlockedLabel(api);
  } catch {
    return;
  }
  for (const issue of blockedTargets) {
    try {
      api.addIssueLabel(issue.number, BLOCKED_LABEL);
    } catch {
      continue;
    }
  }
}

function ensureBlockedLabel(api: DependencyReadinessApi): void {
  if (api.listRepositoryLabels().includes(BLOCKED_LABEL)) return;

  try {
    api.createRepositoryLabel(BLOCKED_LABEL);
  } catch (error) {
    if (!api.listRepositoryLabels().includes(BLOCKED_LABEL)) throw error;
  }
}

function buildComment(dependencies: number[], openDependencies: number[]): string {
  if (openDependencies.length > 0) {
    return `${COMMENT_MARKER}blocked -->\nThis issue is blocked by open dependencies: ${formatReferences(openDependencies)}.`;
  }

  return `${COMMENT_MARKER}unblocked -->\nAll dependencies are closed: ${formatReferences(dependencies)}.`;
}

function formatReferences(issueNumbers: number[]): string {
  return issueNumbers.map((issueNumber) => `#${issueNumber}`).join(", ");
}

function runGh(args: string[]): string {
  const result = spawnSync("gh", ["api", ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`dependency-readiness: gh api ${args[0]} failed (exit ${result.status ?? "unknown"})`);
  }
  return result.stdout;
}

function requestJson<T>(args: string[]): T {
  try {
    return JSON.parse(runGh(args)) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`dependency-readiness: invalid JSON from gh api ${args[0]}`);
    }
    throw error;
  }
}

function listPages<T>(route: (page: number) => string): T[] {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGE_COUNT; page += 1) {
    const batch = requestJson<T[]>([route(page)]);
    if (!Array.isArray(batch)) throw new Error("dependency-readiness: expected a paginated list");
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error("dependency-readiness: pagination limit exceeded");
}

function parseIssue(value: unknown): DependencyIssue {
  if (!value || typeof value !== "object") throw new Error("dependency-readiness: invalid issue response");
  const issue = value as Partial<DependencyIssue>;
  if (
    !Number.isInteger(issue.number) ||
    (issue.state !== "open" && issue.state !== "closed") ||
    (issue.body !== null && typeof issue.body !== "string") ||
    !Array.isArray(issue.labels)
  ) {
    throw new Error("dependency-readiness: invalid issue response");
  }
  return issue as DependencyIssue;
}

class GitHubCliApi implements DependencyReadinessApi {
  constructor(private readonly repository: string) {}

  getIssue(issueNumber: number): DependencyIssue {
    return parseIssue(requestJson<unknown>([`repos/${this.repository}/issues/${issueNumber}`]));
  }

  listOpenIssues(): DependencyIssue[] {
    return listPages<unknown>((page) =>
      `repos/${this.repository}/issues?state=open&per_page=100&page=${page}`
    ).map(parseIssue).filter((issue) => !issue.pull_request);
  }

  listRepositoryLabels(): string[] {
    return listPages<{ name: string }>((page) =>
      `repos/${this.repository}/labels?per_page=100&page=${page}`
    ).map(({ name }) => name);
  }

  createRepositoryLabel(name: string): void {
    runGh([
      "--method", "POST", `repos/${this.repository}/labels`,
      "-f", `name=${name}`, "-f", "color=5319E7", "-f", "description=Issue has open dependencies",
    ]);
  }

  addIssueLabel(issueNumber: number, label: string): void {
    runGh([
      "--method", "POST", `repos/${this.repository}/issues/${issueNumber}/labels`,
      "-f", `labels[]=${label}`,
    ]);
  }

  removeIssueLabel(issueNumber: number, label: string): void {
    runGh(["--method", "DELETE", `repos/${this.repository}/issues/${issueNumber}/labels/${label}`]);
  }

  listIssueComments(issueNumber: number): IssueComment[] {
    return listPages<IssueComment>((page) =>
      `repos/${this.repository}/issues/${issueNumber}/comments?per_page=100&page=${page}`
    );
  }

  createIssueComment(issueNumber: number, body: string): void {
    runGh(["--method", "POST", `repos/${this.repository}/issues/${issueNumber}/comments`, "-f", `body=${body}`]);
  }
}

function runFromEvent(): void {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  if (!/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error("dependency-readiness: GITHUB_REPOSITORY must be owner/name");
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("dependency-readiness: GITHUB_EVENT_PATH is required");
  const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
    action?: string;
    issue?: { number?: number };
    pull_request?: { number?: number };
  };
  const api = new GitHubCliApi(repository);

  if (process.env.GITHUB_EVENT_NAME === "issues") {
    const issueNumber = event.issue?.number;
    if (!Number.isInteger(issueNumber)) throw new Error("dependency-readiness: issue number missing from event");
    if (["opened", "edited", "labeled", "reopened"].includes(event.action ?? "")) {
      reconcileIssue(issueNumber as number, api);
    }
    if (["opened", "closed", "reopened"].includes(event.action ?? "")) {
      reconcileDependents(issueNumber as number, api);
    }
    return;
  }

  if (process.env.GITHUB_EVENT_NAME === "pull_request_target" && ["closed", "reopened"].includes(event.action ?? "")) {
    const pullNumber = event.pull_request?.number;
    if (!Number.isInteger(pullNumber)) throw new Error("dependency-readiness: PR number missing from event");
    reconcileDependents(pullNumber as number, api);
    return;
  }

  throw new Error(`dependency-readiness: unsupported event ${process.env.GITHUB_EVENT_NAME ?? "unknown"}/${event.action ?? "unknown"}`);
}

if (import.meta.main) {
  try {
    runFromEvent();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown failure";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
