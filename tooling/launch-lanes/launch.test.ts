import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";

import {
  AgentNotReadyError,
  agentNameForIssue,
  branchForIssue,
  createLaunchAdapter,
  launchIssues,
  parseArgs,
  parseIssueRef,
  parseRepositoryMap,
  slugifyIssueTitle,
  type AgentDetails,
  type CreatedWorktree,
  type IssueDetails,
  type IssueRef,
  type LaunchAdapter,
  type LaunchDependencies,
  type LaunchOptions,
  type WorktreeDetails,
} from "./launch";

const tempDirs: string[] = [];

function sandbox(): string {
  const path = mkdtempSync(join(tmpdir(), "launch-lanes-"));
  tempDirs.push(path);
  return path;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function issue(repo: string, number: number): IssueRef {
  return parseIssueRef(`${repo}#${number}`);
}

function options(issues: IssueRef[], overrides: Partial<LaunchOptions> = {}): LaunchOptions {
  return {
    issues,
    repositoriesFile: "repositories.json",
    max: 3,
    allowSameRepo: false,
    dryRun: false,
    ...overrides,
  };
}

type AdapterHarness = {
  adapter: LaunchAdapter;
  calls: string[];
  repositoryPaths: Map<string, string>;
  agents: AgentDetails[];
  worktrees: Map<string, WorktreeDetails[]>;
  issues: Map<string, IssueDetails>;
  worktreeRoot: string;
};

function makeAdapter(repositoryPaths: Map<string, string>, initial: Partial<AdapterHarness> = {}): AdapterHarness {
  const root = sandbox();
  const calls: string[] = [];
  const agents = initial.agents ?? [];
  const worktrees = initial.worktrees ?? new Map<string, WorktreeDetails[]>();
  const issueDetails = initial.issues ?? new Map<string, IssueDetails>();
  let created = 0;
  const adapter: LaunchAdapter = {
    checkHerdr: () => { calls.push("checkHerdr"); },
    getIssue: (reference) => {
      calls.push(`getIssue:${reference.repo}#${reference.number}`);
      const found = issueDetails.get(`${reference.repo}#${reference.number}`);
      if (!found) throw new Error("issue not found");
      return found;
    },
    listAgents: () => { calls.push("listAgents"); return agents; },
    waitForCrush: (paneId) => {
      calls.push(`waitForCrush:${paneId}`);
      return { name: "crush", state: "idle", cwd: "/tmp", paneId, kind: "crush" };
    },
    listWorktrees: (repositoryPath) => worktrees.get(repositoryPath) ?? [],
    getDefaultBranch: (repo) => { calls.push(`defaultBranch:${repo}`); return "main"; },
    fetchBaseCommit: (repositoryPath, branch) => { calls.push(`fetch:${repositoryPath}:${branch}`); return "a".repeat(40); },
    createWorktree: (repositoryPath, branch, _base, _label) => {
      calls.push(`createWorktree:${repositoryPath}:${branch}`);
      created += 1;
      const path = join(root, "worktrees", basename(repositoryPath), branch);
      mkdirSync(path, { recursive: true });
      const result: CreatedWorktree = { path, workspaceId: `w${created}`, tabId: `w${created}:t1`, paneId: `w${created}:p1` };
      const entries = worktrees.get(repositoryPath) ?? [];
      entries.push({ path, branch, workspaceId: result.workspaceId });
      worktrees.set(repositoryPath, entries);
      return result;
    },
    startCrush: (worktree) => { calls.push(`startCrush:${worktree.paneId}`); },
    renameAgent: (paneId, name) => { calls.push(`renameAgent:${paneId}:${name}`); },
    promptAgent: (name, prompt) => {
      calls.push(`promptAgent:${name}:${prompt}`);
      return { state: "working" };
    },
  };
  return { adapter, calls, repositoryPaths, agents, worktrees, issues: issueDetails, worktreeRoot: join(root, "worktrees") };
}

function dependencies(harness: AdapterHarness, emit: (line: string) => void = () => {}, promptTemplate = "Work on {repo}#{issue}."): LaunchDependencies {
  return {
    adapter: harness.adapter,
    home: sandbox(),
    herdrWorktreesRoot: harness.worktreeRoot,
    promptTemplate,
    emit,
  };
}

function setupRepos(root: string, repos: string[]): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const repo of repos) {
    const path = join(root, repo.replace("/", "-"));
    mkdirSync(path, { recursive: true });
    mapping.set(repo, path);
  }
  return mapping;
}

describe("tooling/launch-lanes/launch.ts", () => {
  test("parses explicit issue references and launch flags", () => {
    expect(parseIssueRef("sample/thread-atlas#23")).toEqual({ owner: "sample", repository: "thread-atlas", repo: "sample/thread-atlas", number: 23 });
    expect(parseArgs(["--max", "2", "--allow-same-repo", "--dry-run", "--repositories", "~/repos.json", "sample/launch-target#292"], "/test-home")).toEqual({
      issues: [issue("sample/launch-target", 292)],
      repositoriesFile: "/test-home/repos.json",
      max: 2,
      allowSameRepo: true,
      dryRun: true,
    });
    expect(() => parseIssueRef("sample/tracer-workflow#0")).toThrow("invalid issue reference");
    expect(() => parseArgs(["--max", "0", "sample/repo#1"])).toThrow("positive integer");
  });

  test("maps repository checkouts and expands home paths", () => {
    expect(parseRepositoryMap('{"sample/repository":"~/Code/repository"}', "/test-home")).toEqual(
      new Map([["sample/repository", "/test-home/Code/repository"]]),
    );
    expect(() => parseRepositoryMap('{"sample/repository":42}')).toThrow("invalid repository mapping");
  });

  test("matches the GitHub issue workspace slug contract", () => {
    expect(slugifyIssueTitle("CI: rename discipline.yml, unify commit rules, enforce PR body contract")).toBe("ci-rename-discipline-yml-unify-commit-ru");
    expect(branchForIssue(issue("sample/repo", 8), "!!!")).toBe("issue-8");
    expect(branchForIssue(issue("sample/repo", 14), "Protect share-stats endpoint when SHARE_STATS_KEY is unset")).toBe("14-protect-share-stats-endpoint-when-share");
    expect(agentNameForIssue(issue("sample/thread-atlas", 23))).toBe("lane-sample-thread-atlas-23");
  });

  test("dry-run plans within max without creating worktrees or panes", () => {
    const root = sandbox();
    const repositories = setupRepos(root, ["sample/repo-a", "sample/repo-b"]);
    const refs = [issue("sample/repo-a", 1), issue("sample/repo-b", 2), issue("sample/repo-a", 3), issue("sample/repo-b", 4)];
    const issues = new Map(refs.map((reference) => [`${reference.repo}#${reference.number}`, { title: `Issue ${reference.number}`, state: "open", labels: ["ready-for-agent"] }]));
    const harness = makeAdapter(repositories, { issues });
    const deps = dependencies(harness);

    const results = launchIssues(options(refs, { dryRun: true }), repositories, deps);

    expect(results.map(({ status }) => status)).toEqual(["planned", "planned", "skipped", "skipped"]);
    expect(results[2].detail).toContain("another lane for this repository");
    expect(results[3].detail).toContain("another lane for this repository");
    expect(harness.calls.some((call) => call.startsWith("createWorktree"))).toBe(false);
    expect(harness.calls.some((call) => call.startsWith("startCrush"))).toBe(false);
    expect(harness.calls.some((call) => call.startsWith("renameAgent"))).toBe(false);
    expect(harness.calls.some((call) => call.startsWith("promptAgent"))).toBe(false);
  });

  test("launches three lanes across two repositories when same-repo concurrency is allowed", () => {
    const root = sandbox();
    const repositories = setupRepos(root, ["sample/repo-a", "sample/repo-b"]);
    const refs = [issue("sample/repo-a", 1), issue("sample/repo-a", 2), issue("sample/repo-b", 3)];
    const issues = new Map(refs.map((reference) => [`${reference.repo}#${reference.number}`, { title: `Issue ${reference.number}`, state: "open", labels: ["ready-for-agent"] }]));
    const harness = makeAdapter(repositories, { issues });
    const lines: string[] = [];

    const results = launchIssues(options(refs, { allowSameRepo: true }), repositories, dependencies(harness, (line) => lines.push(line), "Implement {repo}#{issue}"));

    expect(results.map(({ status }) => status)).toEqual(["started", "started", "started"]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("agent lane-sample-repo-a-1, workspace w1");
    expect(harness.calls.filter((call) => call.startsWith("createWorktree"))).toHaveLength(3);
    expect(harness.calls.filter((call) => call.startsWith("renameAgent"))).toHaveLength(3);
    expect(harness.calls.filter((call) => call.startsWith("waitForCrush"))).toHaveLength(3);
    expect(harness.calls.filter((call) => call.startsWith("promptAgent"))).toHaveLength(3);
    expect(harness.calls).toContain("promptAgent:lane-sample-repo-a-1:Implement sample/repo-a#1");
    for (const result of results) {
      const path = join(harness.worktreeRoot, basename(repositories.get(result.issue.repo)!), branchForIssue(result.issue, `Issue ${result.issue.number}`));
      expect(readFileSync(join(path, ".crush", ".gitignore"), "utf8")).toBe("*\n");
      expect(readFileSync(join(path, ".crush", "init"), "utf8")).toBe("");
    }
  });

  test("skips closed, blocked, missing-mapped, and duplicate worktree issues while continuing", () => {
    const root = sandbox();
    const repositories = setupRepos(root, ["sample/repo"]);
    const refs = [issue("sample/repo", 1), issue("sample/repo", 2), issue("sample/repo", 3), issue("sample/repo", 4), issue("sample/repo", 5)];
    const issues = new Map<string, IssueDetails>([
      ["sample/repo#1", { title: "Closed", state: "closed", labels: ["ready-for-agent"] }],
      ["sample/repo#2", { title: "Blocked", state: "open", labels: ["blocked"] }],
      ["sample/repo#3", { title: "Duplicate", state: "open", labels: ["ready-for-agent"] }],
      ["sample/repo#4", { title: "Missing map", state: "open", labels: ["ready-for-agent"] }],
      ["sample/repo#5", { title: "Continue", state: "open", labels: ["ready-for-agent"] }],
    ]);
    const repositoryPath = repositories.get("sample/repo")!;
    const harness = makeAdapter(repositories, { issues, worktrees: new Map([[repositoryPath, [{ path: "duplicate-worktree", branch: "3-duplicate", workspaceId: "w0" }, { path: "missing-map-worktree", branch: "4-missing-map", workspaceId: "w0" }]]]) });
    const results = launchIssues(options(refs, { allowSameRepo: true, max: 5 }), repositories, dependencies(harness));

    expect(results.map(({ status }) => status)).toEqual(["skipped", "skipped", "skipped", "skipped", "started"]);
    expect(results[0].detail).toContain("closed");
    expect(results[1].detail).toContain("HITL or blocked");
    expect(results[2].detail).toContain("worktree already exists");
    expect(harness.calls.some((call) => call.startsWith("createWorktree") && call.endsWith("5-continue"))).toBe(true);
  });

  test("caps starts at --max even when same-repository launches are allowed", () => {
    const root = sandbox();
    const repositories = setupRepos(root, ["sample/repo-a", "sample/repo-b", "sample/repo-c"]);
    const refs = [issue("sample/repo-a", 1), issue("sample/repo-b", 2), issue("sample/repo-c", 3)];
    const issues = new Map(refs.map((reference) => [`${reference.repo}#${reference.number}`, { title: `Issue ${reference.number}`, state: "open", labels: ["ready-for-agent"] }]));
    const harness = makeAdapter(repositories, { issues });

    const results = launchIssues(options(refs, { allowSameRepo: true, max: 2 }), repositories, dependencies(harness));

    expect(results.map(({ status }) => status)).toEqual(["started", "started", "skipped"]);
    expect(results[2].detail).toContain("--max 2");
    expect(harness.calls.filter((call) => call.startsWith("createWorktree"))).toHaveLength(2);
  });

  test("skips missing, closed, HITL, and unmapped issues while launching eligible work", () => {
    const root = sandbox();
    const repositories = setupRepos(root, ["sample/repo"]);
    const missingCheckout = join(root, "missing-checkout");
    repositories.set("sample/missing", missingCheckout);
    const refs = [issue("sample/unmapped", 1), issue("sample/missing", 2), issue("sample/repo", 3), issue("sample/repo", 4), issue("sample/repo", 5), issue("sample/repo", 6), issue("sample/repo", 7)];
    const issues = new Map<string, IssueDetails>([
      ["sample/unmapped#1", { title: "No mapping", state: "open", labels: ["ready-for-agent"] }],
      ["sample/missing#2", { title: "Missing checkout", state: "open", labels: ["ready-for-agent"] }],
      ["sample/repo#3", { title: "HITL label", state: "open", labels: ["ready-for-agent", "HITL"] }],
      ["sample/repo#4", { title: "[needs-human] Decision", state: "open", labels: ["ready-for-agent"] }],
      ["sample/repo#5", { title: "Closed", state: "closed", labels: ["ready-for-agent"] }],
      ["sample/repo#7", { title: "Continue", state: "open", labels: ["ready-for-agent"] }],
    ]);
    const harness = makeAdapter(repositories, { issues });

    const results = launchIssues(options(refs, { allowSameRepo: true, max: 7 }), repositories, dependencies(harness));

    expect(results.map(({ status }) => status)).toEqual(["skipped", "skipped", "skipped", "skipped", "skipped", "skipped", "started"]);
    expect(results[0].detail).toContain("no checkout mapping");
    expect(results[1].detail).toContain("does not exist");
    expect(results[2].detail).toContain("HITL or blocked");
    expect(results[3].detail).toContain("HITL or blocked");
    expect(results[4].detail).toContain("closed");
    expect(results[5].detail).toContain("unable to load issue");
  });

  test("a repeated invocation skips an already-launched issue", () => {
    const root = sandbox();
    const repositories = setupRepos(root, ["sample/repo"]);
    const reference = issue("sample/repo", 11);
    const issues = new Map([["sample/repo#11", { title: "Repeated launch", state: "open", labels: ["ready-for-agent"] }]]);
    const harness = makeAdapter(repositories, { issues });
    const deps = dependencies(harness);

    const first = launchIssues(options([reference]), repositories, deps);
    const second = launchIssues(options([reference]), repositories, deps);

    expect(first[0].status).toBe("started");
    expect(second[0].status).toBe("skipped");
    expect(second[0].detail).toContain("worktree already exists");
    expect(harness.calls.filter((call) => call.startsWith("createWorktree"))).toHaveLength(1);
    expect(harness.calls.filter((call) => call.startsWith("promptAgent"))).toHaveLength(1);
  });

  test("skips active same-repository lanes and duplicate issue inputs", () => {
    const root = sandbox();
    const repositories = setupRepos(root, ["sample/repo"]);
    const reference = issue("sample/repo", 9);
    const repositoryPath = repositories.get("sample/repo")!;
    const agents: AgentDetails[] = [{ name: "other", state: "working", cwd: repositoryPath, paneId: "w1:p1", kind: "crush" }];
    const harness = makeAdapter(repositories, {
      agents,
      issues: new Map([["sample/repo#9", { title: "One", state: "open", labels: ["ready-for-agent"] }]]),
    });

    const results = launchIssues(options([reference, reference]), repositories, dependencies(harness));

    expect(results.map(({ status }) => status)).toEqual(["skipped", "skipped"]);
    expect(results[0].detail).toContain("another lane");
    expect(results[1].detail).toContain("duplicate issue argument");
  });

  test("agent_not_ready after rename is fatal and never sends a prompt through pane input", () => {
    const root = sandbox();
    const repositories = setupRepos(root, ["sample/repo"]);
    const reference = issue("sample/repo", 10);
    const calls: Array<{ command: string; args: string[] }> = [];
    const outputs = new Map<string, string>([
      ["herdr status", "{}"],
      ["herdr agent list", JSON.stringify({ result: { agents: [{ name: "crush", state: "idle", agent: "crush", pane_id: "w1:p1", cwd: "worktree-root" }] } })],
      ["gh issue view", JSON.stringify({ number: 10, title: "Agent not ready", state: "OPEN", labels: [{ name: "ready-for-agent" }] })],
      ["gh repo view", JSON.stringify({ defaultBranchRef: { name: "main" } })],
      ["git fetch", ""],
      ["git rev-parse", "a".repeat(40)],
      ["herdr worktree create", JSON.stringify({ result: { workspace: { workspace_id: "w1" }, tab: { tab_id: "w1:t1" }, root_pane: { pane_id: "w1:p1" }, worktree: { path: join(root, "created"), branch: "10-agent-not-ready" } } })],
      ["herdr pane run", ""],
      ["herdr agent rename", "{}"],
    ]);
    const adapter = createLaunchAdapter((command, args) => {
      calls.push({ command, args });
      const key = `${command} ${args[0]}`;
      if (command === "git" && args[0] === "worktree") return "";
      if (command === "herdr" && args[0] === "status") return outputs.get("herdr status")!;
      if (command === "herdr" && args[0] === "worktree" && args[1] === "list") return JSON.stringify({ worktrees: [] });
      if (command === "herdr" && args[0] === "worktree" && args[1] === "create") return outputs.get("herdr worktree create")!;
      if (command === "herdr" && args[0] === "agent" && args[1] === "list") return outputs.get("herdr agent list")!;
      if (command === "gh" && args[0] === "issue") return outputs.get("gh issue view")!;
      if (command === "gh" && args[0] === "repo") return outputs.get("gh repo view")!;
      if (command === "herdr" && args[0] === "pane" && args[1] === "run") return outputs.get("herdr pane run")!;
      if (command === "git" && args[0] === "fetch") return outputs.get("git fetch")!;
      if (command === "git" && args[0] === "rev-parse") return outputs.get("git rev-parse")!;
      if (command === "herdr" && args[0] === "agent" && args[1] === "rename") return outputs.get("herdr agent rename")!;
      if (command === "herdr" && args[0] === "agent" && args[1] === "prompt") throw new Error(`agent_not_ready: agent ${args[2]} is not an active named agent`);
      throw new Error(`unexpected command ${key}`);
    });
    const dependencies: LaunchDependencies = {
      adapter,
      home: root,
      herdrWorktreesRoot: join(root, "worktrees"),
      promptTemplate: "Implement {repo}#{issue}",
      emit: () => {},
    };
    const issueMap = new Map([["sample/repo#10", { title: "Agent not ready", state: "open", labels: ["ready-for-agent"] }]]);
    const fakeAdapter = adapter as LaunchAdapter;
    fakeAdapter.listAgents = () => [{ name: "crush", state: "idle", cwd: "worktree-root", paneId: "w1:p1", kind: "crush" }];
    fakeAdapter.waitForCrush = (paneId) => ({ name: "crush", state: "idle", cwd: "worktree-root", paneId, kind: "crush" });
    fakeAdapter.getIssue = () => issueMap.get("sample/repo#10")!;

    expect(() => launchIssues(options([reference]), repositories, dependencies)).toThrow(/agent_not_ready after rename for pane w1:p1:.*agent_not_ready: agent lane-sample-repo-10 is not an active named agent/);
    const renameIndex = calls.findIndex(({ command, args }) => command === "herdr" && args[0] === "agent" && args[1] === "rename");
    const promptIndex = calls.findIndex(({ command, args }) => command === "herdr" && args[0] === "agent" && args[1] === "prompt");
    expect(renameIndex).toBeGreaterThan(-1);
    expect(promptIndex).toBeGreaterThan(renameIndex);
    expect(calls[promptIndex].args).toEqual(["agent", "prompt", "lane-sample-repo-10", "Implement sample/repo#10", "--wait", "--until", "working", "--timeout", "120000"]);
    expect(calls.filter(({ command, args }) => command === "herdr" && args[0] === "pane" && args[1] === "run")).toEqual([{ command: "herdr", args: ["pane", "run", "w1:p1", "crush"] }]);
    expect(calls.some(({ command, args }) => command === "herdr" && args[0] === "pane" && args[1] === "send-keys")).toBe(false);
    expect(calls.some(({ command, args }) => command === "herdr" && args[0] === "agent" && args[1] === "send-keys")).toBe(false);
  });

  test("Herdr adapter starts Crush then renames and prompts without send-keys", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = (command: string, args: string[]) => {
      calls.push({ command, args });
      if (command === "herdr" && args[0] === "pane" && args[1] === "run") return "";
      if (command === "herdr" && args[0] === "agent" && args[1] === "list") return JSON.stringify({ result: { agents: [{ name: "crush", state: "idle", agent: "crush", pane_id: "w1:p1", cwd: "worktree-root" }] } });
      if (command === "herdr" && args[0] === "agent" && args[1] === "prompt") return JSON.stringify({ agent: { agent_status: "working" } });
      return "{}";
    };
    const adapter = createLaunchAdapter(runner);

    const worktree: CreatedWorktree = { path: "worktree-root", workspaceId: "w1", tabId: "w1:t1", paneId: "w1:p1" };
    adapter.startCrush(worktree);
    expect(adapter.waitForCrush("w1:p1", 500).kind).toBe("crush");
    adapter.renameAgent("w1:p1", "lane-sample-repo-10");
    expect(adapter.promptAgent("lane-sample-repo-10", "Implement issue")).toEqual({ state: "working" });

    expect(calls).toContainEqual({ command: "herdr", args: ["pane", "run", "w1:p1", "crush"] });
    expect(calls.some(({ command, args }) => command === "herdr" && args[0] === "pane" && args[1] === "send-keys")).toBe(false);
    expect(calls.some(({ command, args }) => command === "herdr" && args[0] === "agent" && args[1] === "send-keys")).toBe(false);
    const renameIndex = calls.findIndex(({ command, args }) => command === "herdr" && args[0] === "agent" && args[1] === "rename");
    const promptIndex = calls.findIndex(({ command, args }) => command === "herdr" && args[0] === "agent" && args[1] === "prompt");
    expect(renameIndex).toBeGreaterThan(-1);
    expect(promptIndex).toBeGreaterThan(renameIndex);
    expect(calls.some(({ args }) => args.includes("--env") || args.some((arg) => arg.startsWith("HERDR_")))).toBe(false);
  });
});
