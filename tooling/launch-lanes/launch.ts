#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type CommandRunner = (command: string, args: string[], cwd?: string) => string;
export type IssueRef = {
  owner: string;
  repository: string;
  repo: string;
  number: number;
};

export type IssueDetails = {
  title: string;
  state: string;
  labels: string[];
};

export type AgentDetails = {
  name: string;
  state: string;
  cwd: string;
  paneId: string;
  kind: string;
};

export type WorktreeDetails = {
  path: string;
  branch: string;
  workspaceId: string;
};

export type CreatedWorktree = {
  path: string;
  workspaceId: string;
  tabId: string;
  paneId: string;
};

export type PromptResult = {
  state?: string;
};

export type LaunchAdapter = {
  checkHerdr(): void;
  getIssue(issue: IssueRef): IssueDetails;
  listAgents(): AgentDetails[];
  waitForCrush(paneId: string, timeoutMs: number): AgentDetails;
  listWorktrees(repositoryPath: string): WorktreeDetails[];
  getDefaultBranch(repo: string): string;
  fetchBaseCommit(repositoryPath: string, branch: string): string;
  createWorktree(repositoryPath: string, branch: string, base: string, label: string): CreatedWorktree;
  startCrush(worktree: CreatedWorktree): void;
  renameAgent(paneId: string, name: string): void;
  promptAgent(name: string, prompt: string): PromptResult;
};

export type LaunchOptions = {
  issues: IssueRef[];
  repositoriesFile: string;
  max: number;
  allowSameRepo: boolean;
  dryRun: boolean;
};

export type LaunchResult = {
  issue: IssueRef;
  status: "started" | "planned" | "skipped";
  detail: string;
};

export type LaunchDependencies = {
  adapter: LaunchAdapter;
  home: string;
  herdrWorktreesRoot: string;
  promptTemplate: string;
  emit: (line: string) => void;
};

export class HerdrCommandError extends Error {
  constructor(args: string[], detail: string) {
    super(`herdr ${args.join(" ")} failed: ${detail}`);
    this.name = "HerdrCommandError";
  }
}

export class AgentNotReadyError extends Error {
  constructor(paneId: string, detail: string) {
    super(`agent_not_ready after rename for pane ${paneId}: ${detail}`);
    this.name = "AgentNotReadyError";
  }
}

export function parseIssueRef(value: string): IssueRef {
  const match = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([1-9][0-9]*)$/);
  if (!match) throw new Error(`invalid issue reference: ${value} (expected owner/repo#N)`);
  const [, owner, repository, number] = match;
  const parsedNumber = Number(number);
  if (!Number.isSafeInteger(parsedNumber)) throw new Error(`invalid issue number: ${number}`);
  return { owner, repository, repo: `${owner}/${repository}`, number: parsedNumber };
}

export function parseArgs(argv: string[], home = process.env.HOME ?? ""): LaunchOptions {
  const issues: IssueRef[] = [];
  let repositoriesFile = join(home, ".config", "tracer", "launch-lanes", "repositories.json");
  let max = 3;
  let allowSameRepo = false;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--allow-same-repo") {
      allowSameRepo = true;
      continue;
    }
    if (arg === "--max") {
      const value = argv[++index];
      if (!value || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("--max requires a positive integer");
      max = Number(value);
      continue;
    }
    if (arg === "--repositories") {
      const value = argv[++index];
      if (!value) throw new Error("--repositories requires a JSON file path");
      repositoriesFile = expandHome(value, home);
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    issues.push(parseIssueRef(arg));
  }

  if (issues.length === 0) throw new Error("provide one or more owner/repo#N issue references");
  return { issues, repositoriesFile, max, allowSameRepo, dryRun };
}

export function parseRepositoryMap(contents: string, home = process.env.HOME ?? ""): Map<string, string> {
  const value: unknown = JSON.parse(contents);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("repository map must be a JSON object");
  const entries = Object.entries(value as Record<string, unknown>);
  const mappings = new Map<string, string>();
  for (const [repo, path] of entries) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || typeof path !== "string" || path.trim() === "") {
      throw new Error(`invalid repository mapping for ${repo}`);
    }
    mappings.set(repo, resolve(expandHome(path.trim(), home)));
  }
  return mappings;
}

export function slugifyIssueTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function branchForIssue(issue: Pick<IssueRef, "number">, title: string): string {
  const slug = slugifyIssueTitle(title);
  return slug ? `${issue.number}-${slug}` : `issue-${issue.number}`;
}

export function agentNameForIssue(issue: IssueRef): string {
  const suffix = `-${issue.number}`;
  const prefix = `lane-${issue.owner}-${issue.repository}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/, "");
  return `${prefix.slice(0, 32 - suffix.length)}${suffix}`;
}

export function expandHome(value: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  return value;
}

function commandRunner(command: string, args: string[], cwd?: string): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    if (command === "herdr") throw new HerdrCommandError(args, errorMessage(error));
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nestedRecords(value: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    const record = asRecord(current);
    if (!record) return;
    found.push(record);
    Object.values(record).forEach(visit);
  };
  visit(value);
  return found;
}

function parseJson(output: string, description: string): unknown {
  try {
    return JSON.parse(output) as unknown;
  } catch {
    throw new Error(`${description} did not return valid JSON`);
  }
}

function firstString(records: Record<string, unknown>[], names: string[]): string | undefined {
  for (const record of records) {
    for (const name of names) {
      const value = record[name];
      if (typeof value === "string" && value.trim() !== "") return value;
    }
  }
  return undefined;
}

function arrayFor(value: unknown, names: string[]): unknown[] {
  for (const record of nestedRecords(value)) {
    for (const name of names) {
      if (Array.isArray(record[name])) return record[name] as unknown[];
    }
  }
  return Array.isArray(value) ? value : [];
}

function parseHerdrAgents(output: string): AgentDetails[] {
  const envelope = asRecord(parseJson(output, "herdr agent list"));
  const value = asRecord(envelope?.result);
  const agents = Array.isArray(value?.agents) ? value.agents : [];
  return agents.flatMap((entry) => {
    const records = nestedRecords(entry);
    const name = firstString(records, ["name", "agent_name"]);
    const state = firstString(records, ["state", "status", "agent_status"]);
    const cwd = firstString(records, ["cwd", "working_directory", "worktree_path", "path"]);
    const paneId = firstString(records, ["pane_id", "paneId", "id"]);
    const kind = firstString(records, ["agent", "kind", "agent_type", "type"]);
    if (!name && !state && !cwd && !paneId) return [];
    return [{ name: name ?? "", state: (state ?? "unknown").toLowerCase(), cwd: cwd ?? "", paneId: paneId ?? "", kind: (kind ?? "").toLowerCase() }];
  });
}

function parseGitWorktrees(output: string): WorktreeDetails[] {
  const worktrees: WorktreeDetails[] = [];
  let path = "";
  let branch = "";
  const save = () => {
    if (path) worktrees.push({ path, branch: branch.replace(/^refs\/heads\//, ""), workspaceId: "" });
    path = "";
    branch = "";
  };
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    if (line.startsWith("branch ")) branch = line.slice("branch ".length);
    if (line.trim() === "") save();
  }
  save();
  return worktrees;
}

function parseHerdrWorktrees(output: string): WorktreeDetails[] {
  const records = nestedRecords(parseJson(output, "herdr worktree list"));
  const worktrees = records.find((record) => Array.isArray(record.worktrees))?.worktrees as unknown[] | undefined;
  return (worktrees ?? []).flatMap((entry) => {
    const record = asRecord(entry);
    const path = typeof record?.path === "string" ? record.path : undefined;
    const branch = typeof record?.branch === "string" ? record.branch : undefined;
    const workspaceId = typeof record?.open_workspace_id === "string" ? record.open_workspace_id : "";
    if (!path || !branch) return [];
    return [{ path, branch: branch.replace(/^refs\/heads\//, ""), workspaceId }];
  });
}

function parseWorktreeCreation(output: string): Partial<CreatedWorktree> {
  const records = nestedRecords(parseJson(output, "herdr worktree create"));
  const workspace = records.find((record) => typeof record.workspace_id === "string");
  const tab = records.find((record) => typeof record.tab_id === "string");
  const pane = records.find((record) => typeof record.pane_id === "string");
  const worktree = records.find((record) => typeof record.branch === "string" && typeof record.path === "string");
  return {
    path: typeof worktree?.path === "string" ? worktree.path : undefined,
    workspaceId: typeof workspace?.workspace_id === "string" ? workspace.workspace_id : undefined,
    tabId: typeof tab?.tab_id === "string" ? tab.tab_id : undefined,
    paneId: typeof pane?.pane_id === "string" ? pane.pane_id : undefined,
  };
}

function parseIssueLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((label) => {
    if (typeof label === "string") return [label];
    const record = asRecord(label);
    return typeof record?.name === "string" ? [record.name] : [];
  });
}

export function createLaunchAdapter(run: CommandRunner = commandRunner): LaunchAdapter {
  const runHerdr = (args: string[]): string => {
    try {
      return run("herdr", args);
    } catch (error) {
      throw new HerdrCommandError(args, errorMessage(error));
    }
  };
  return {
    checkHerdr() {
      runHerdr(["status"]);
    },
    getIssue(issue) {
      const output = run("gh", ["issue", "view", String(issue.number), "--repo", issue.repo, "--json", "number,title,state,labels"]);
      const value = asRecord(parseJson(output, `gh issue view ${issue.repo}#${issue.number}`));
      if (!value || typeof value.title !== "string" || typeof value.state !== "string") {
        throw new Error(`GitHub returned incomplete issue details for ${issue.repo}#${issue.number}`);
      }
      return { title: value.title, state: value.state.toLowerCase(), labels: parseIssueLabels(value.labels) };
    },
    listAgents() {
      return parseHerdrAgents(runHerdr(["agent", "list"]));
    },
    waitForCrush(paneId, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const agent = parseHerdrAgents(runHerdr(["agent", "list"])).find((candidate) => candidate.paneId === paneId);
        if (agent && agent.state === "blocked") throw new Error(`Crush agent is blocked on pane ${paneId}`);
        if (agent && /crush/i.test(agent.kind)) return agent;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(500, deadline - Date.now()));
      }
      throw new Error(`Herdr did not recognize a Crush agent on pane ${paneId} within ${timeoutMs}ms`);
    },
    listWorktrees(repositoryPath) {
      const gitWorktrees = parseGitWorktrees(run("git", ["worktree", "list", "--porcelain"], repositoryPath));
      const herdrWorktrees = parseHerdrWorktrees(runHerdr(["worktree", "list", "--cwd", repositoryPath]));
      const herdrByPath = new Map(herdrWorktrees.map((worktree) => [resolve(worktree.path), worktree]));
      return gitWorktrees.map((worktree) => {
        const herdrWorktree = herdrByPath.get(resolve(worktree.path));
        return herdrWorktree ? { ...worktree, workspaceId: herdrWorktree.workspaceId } : worktree;
      });
    },
    getDefaultBranch(repo) {
      const value = asRecord(parseJson(run("gh", ["repo", "view", repo, "--json", "defaultBranchRef"]), `gh repo view ${repo}`));
      const defaultBranch = asRecord(value?.defaultBranchRef)?.name;
      if (typeof defaultBranch !== "string" || defaultBranch === "") throw new Error(`GitHub did not report a default branch for ${repo}`);
      return defaultBranch;
    },
    fetchBaseCommit(repositoryPath, branch) {
      run("git", ["fetch", "origin", branch], repositoryPath);
      return run("git", ["rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`], repositoryPath).trim();
    },
    createWorktree(repositoryPath, branch, base, label) {
      const output = runHerdr(["worktree", "create", "--cwd", repositoryPath, "--branch", branch, "--base", base, "--label", label, "--no-focus"]);
      const created = parseWorktreeCreation(output);
      const worktreePath = created.path;
      const workspaceId = created.workspaceId;
      const tabId = created.tabId;
      const paneId = created.paneId;
      if (!worktreePath || !workspaceId || !tabId || !paneId) {
        throw new Error(`Herdr created ${branch} but did not return its worktree path, workspace ID, tab ID, and root pane ID`);
      }
      return { path: resolve(worktreePath), workspaceId, tabId, paneId };
    },
    startCrush(worktree) {
      const args = ["pane", "run", worktree.paneId, "crush"];
      try {
        runHerdr(args);
      } catch (error) {
        throw new HerdrCommandError(args, errorMessage(error));
      }
    },
    renameAgent(paneId, name) {
      runHerdr(["agent", "rename", paneId, name]);
    },
    promptAgent(name, prompt) {
      const output = runHerdr(["agent", "prompt", name, prompt, "--wait", "--until", "working", "--timeout", "120000"]);
      const value = parseJson(output, "herdr agent prompt");
      const state = firstString(nestedRecords(value), ["agent_status", "state", "status"]);
      if (!state) throw new Error("herdr agent prompt did not confirm a lifecycle state");
      return { state: state.toLowerCase() };
    },
  };
}

function withinPath(path: string, root: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  const child = relative(resolvedRoot, resolvedPath);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function agentBelongsToRepo(agent: AgentDetails, repositoryPath: string, herdrWorktreesRoot: string): boolean {
  if (!agent.cwd) return false;
  return withinPath(agent.cwd, repositoryPath) || withinPath(agent.cwd, join(herdrWorktreesRoot, basename(repositoryPath)));
}

function isActive(agent: AgentDetails): boolean {
  return agent.state !== "done" && agent.state !== "exited" && agent.state !== "stopped";
}

function duplicateReason(branch: string, name: string, worktrees: WorktreeDetails[], agents: AgentDetails[]): string | undefined {
  if (worktrees.some((worktree) => worktree.branch === branch || basename(worktree.path) === branch)) return `worktree already exists (${branch})`;
  if (agents.some((agent) => isActive(agent) && (agent.name === name || (agent.cwd !== "" && basename(agent.cwd) === branch)))) return `live agent already exists (${name})`;
  return undefined;
}

function hitlOrBlocked(issue: IssueDetails): string | undefined {
  const labels = new Set(issue.labels.map((label) => label.toLowerCase()));
  if (issue.state !== "open") return `issue is ${issue.state}`;
  if (labels.has("hitl") || labels.has("blocked") || /^\[(?:hitl|needs-human)\]/i.test(issue.title)) return "issue is HITL or blocked";
  if (!labels.has("ready-for-agent")) return "issue lacks ready-for-agent label";
  return undefined;
}

function renderPrompt(template: string, issue: IssueRef): string {
  if (!template.includes("{repo}") || !template.includes("{issue}")) throw new Error("prompt template must include {repo} and {issue}");
  return template.replaceAll("{repo}", issue.repo).replaceAll("{issue}", String(issue.number));
}

function prepareWorktree(path: string): void {
  const crushDir = join(path, ".crush");
  mkdirSync(crushDir, { recursive: true });
  const ignorePath = join(crushDir, ".gitignore");
  if (existsSync(ignorePath)) {
    if (readFileSync(ignorePath, "utf8") !== "*\n") throw new Error(`refusing to replace existing ${ignorePath}`);
  } else {
    writeFileSync(ignorePath, "*\n", { flag: "wx" });
  }
  const initPath = join(crushDir, "init");
  if (existsSync(initPath)) {
    if (readFileSync(initPath, "utf8") !== "") throw new Error(`refusing to replace non-empty ${initPath}`);
  } else {
    writeFileSync(initPath, "", { flag: "wx" });
  }
}

function formatResult(result: LaunchResult): string {
  return `${result.issue.repo}#${result.issue.number} ${result.status}: ${result.detail}`;
}

export function launchIssues(options: LaunchOptions, repositories: Map<string, string>, dependencies: LaunchDependencies): LaunchResult[] {
  const { adapter, emit } = dependencies;
  adapter.checkHerdr();
  const agents = adapter.listAgents();
  const results: LaunchResult[] = [];
  const seenInputs = new Set<string>();
  const startedRepos = new Set<string>();
  let started = 0;

  const report = (issue: IssueRef, status: LaunchResult["status"], detail: string): void => {
    const result = { issue, status, detail };
    results.push(result);
    emit(formatResult(result));
  };

  for (const issue of options.issues) {
    const issueKey = `${issue.repo}#${issue.number}`;
    if (seenInputs.has(issueKey)) {
      report(issue, "skipped", "duplicate issue argument");
      continue;
    }
    seenInputs.add(issueKey);

    let details: IssueDetails;
    try {
      details = adapter.getIssue(issue);
    } catch (error) {
      report(issue, "skipped", `unable to load issue: ${errorMessage(error)}`);
      continue;
    }
    const eligibilityReason = hitlOrBlocked(details);
    if (eligibilityReason) {
      report(issue, "skipped", eligibilityReason);
      continue;
    }

    const repositoryPath = repositories.get(issue.repo);
    if (!repositoryPath) {
      report(issue, "skipped", "repository has no checkout mapping");
      continue;
    }
    if (!existsSync(repositoryPath)) {
      report(issue, "skipped", `mapped checkout does not exist (${repositoryPath})`);
      continue;
    }

    const branch = branchForIssue(issue, details.title);
    const name = agentNameForIssue(issue);
    let worktrees: WorktreeDetails[];
    try {
      worktrees = adapter.listWorktrees(repositoryPath);
    } catch (error) {
      if (error instanceof HerdrCommandError) throw error;
      report(issue, "skipped", `unable to inspect mapped checkout: ${errorMessage(error)}`);
      continue;
    }
    const duplicate = duplicateReason(branch, name, worktrees, agents);
    if (duplicate) {
      report(issue, "skipped", duplicate);
      continue;
    }

    if (!options.allowSameRepo && (startedRepos.has(issue.repo) || agents.some((agent) => isActive(agent) && agentBelongsToRepo(agent, repositoryPath, dependencies.herdrWorktreesRoot)))) {
      report(issue, "skipped", "another lane for this repository is already active");
      continue;
    }
    if (started >= options.max) {
      report(issue, "skipped", `run limit reached (--max ${options.max})`);
      continue;
    }

    if (options.dryRun) {
      if (!options.allowSameRepo) startedRepos.add(issue.repo);
      started += 1;
      report(issue, "planned", `branch ${branch}, checkout ${repositoryPath}`);
      continue;
    }

    try {
      const defaultBranch = adapter.getDefaultBranch(issue.repo);
      const base = adapter.fetchBaseCommit(repositoryPath, defaultBranch);
      const worktree = adapter.createWorktree(repositoryPath, branch, base, `#${issue.number} ${details.title}`);
      prepareWorktree(worktree.path);
      const paneId = worktree.paneId;
      adapter.startCrush(worktree);
      const startedAgent = adapter.waitForCrush(paneId, 120000);
      adapter.renameAgent(paneId, name);
      const prompt = renderPrompt(dependencies.promptTemplate, issue);
      let promptResult: PromptResult;
      try {
        promptResult = adapter.promptAgent(name, prompt);
      } catch (error) {
        const message = errorMessage(error);
        if (/agent_not_ready/i.test(message)) throw new AgentNotReadyError(paneId, message);
        if (error instanceof HerdrCommandError && !/agent_blocked|agent_prompt_stalled/i.test(message)) throw error;
        report(issue, "skipped", `prompt was not accepted for pane ${paneId}: ${message}`);
        continue;
      }
      if (promptResult.state !== "working") {
        report(issue, "skipped", `agent ${name} reached ${promptResult.state}, not working (pane ${paneId})`);
        continue;
      }
      started += 1;
      startedRepos.add(issue.repo);
      agents.push({ ...startedAgent, name, state: "working", cwd: worktree.path, paneId, kind: "crush" });
      report(issue, "started", `agent ${name}, workspace ${worktree.workspaceId}`);
    } catch (error) {
      if (error instanceof AgentNotReadyError || error instanceof HerdrCommandError) throw error;
      report(issue, "skipped", `launch failed: ${errorMessage(error)}`);
    }
  }
  return results;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const detail = (error as Error & { stderr?: string }).stderr;
    return `${error.message}${detail ? `: ${String(detail).trim()}` : ""}`;
  }
  return String(error);
}

export function loadPromptTemplate(path = join(dirname(fileURLToPath(import.meta.url)), "prompt.txt")): string {
  return readFileSync(path, "utf8").trim();
}

export function loadRepositoryMap(path: string, home = process.env.HOME ?? ""): Map<string, string> {
  return parseRepositoryMap(readFileSync(expandHome(path, home), "utf8"), home);
}

export function main(argv = process.argv.slice(2)): number {
  let options: LaunchOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 2;
  }

  try {
    const home = process.env.HOME ?? "";
    const repositories = loadRepositoryMap(options.repositoriesFile, home);
    const adapter = createLaunchAdapter();
    launchIssues(options, repositories, {
      adapter,
      home,
      herdrWorktreesRoot: join(home, ".herdr", "worktrees"),
      promptTemplate: loadPromptTemplate(),
      emit: (line) => process.stdout.write(`${line}\n`),
    });
    return 0;
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = main();

export { parseGitWorktrees, parseHerdrAgents, parseHerdrWorktrees, renderPrompt };
