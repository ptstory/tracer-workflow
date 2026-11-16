import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configuredRepositories,
  governingIssueIsHitl,
  parseSnapshot,
  readHerdrSnapshot,
  notificationCandidate,
  pullRequestDecision,
  reconcile,
  validateConfig,
  watch,
  watchedRepositories,
  type CommandResult,
  type CommandRunner,
  type WatcherConfig,
  type WatcherDependencies,
} from "./watcher";
import type { Comment, Verdict } from "../lib/verdict";

const HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PREVIOUS_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const MIDDLE_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const REVIEWER_LOGINS = ["review-bot"];
const REPOSITORY = "acme/repo";
const PULL_REQUEST_URL = "https://github.com/acme/repo/pull/98";
const CONFIG: WatcherConfig = {
  repositories: [REPOSITORY],
  reviewer_logins: REVIEWER_LOGINS,
  refresh_interval_seconds: 15,
};

let temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryDirectories = [];
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "tracer-watcher-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function makeComment(verdict: Verdict, options: { headSha?: string; author?: string; round?: number; createdAt?: string; body?: string } = {}): Comment {
  const headSha = options.headSha ?? HEAD_SHA;
  const nextAction = verdict === "needs-fix"
    ? `from-pr-review ${PULL_REQUEST_URL}`
    : verdict === "merge-candidate"
      ? `gh pr merge 98 --squash --match-head-commit ${headSha}`
      : verdict === "needs-human"
        ? "gh pr view 98 --web"
        : "gh pr checks 98";
  return {
    author: options.author === undefined ? { login: "review-bot" } : { login: options.author },
    body: options.body ?? `## review-gate: ${verdict}\nhead-sha: ${headSha}\nreview-round: ${options.round ?? 0}\nreviewed-files: 1\nblocking-set: ${verdict === "needs-fix" ? "src/api.ts" : ""}\nnext-action: ${nextAction}\n`,
    createdAt: options.createdAt ?? "2026-11-15T00:00:00Z",
  };
}

function makePullRequest(overrides: Partial<Parameters<typeof pullRequestDecision>[1]> = {}) {
  return {
    number: 98,
    title: "Update API behavior",
    url: PULL_REQUEST_URL,
    headRefOid: HEAD_SHA,
    labels: [{ name: "gate:needs-fix" }],
    closingIssuesReferences: [{ number: 77 }],
    ...overrides,
  };
}

function result(stdout = "", status = 0, stderr = ""): CommandResult {
  return { stdout, status, stderr };
}

function commentApi(comments: Comment[]): string {
  return JSON.stringify([comments.map((comment) => ({
    user: comment.author ? { login: comment.author.login } : null,
    body: comment.body,
    created_at: comment.createdAt,
  }))]);
}

function harness(options: { pr?: ReturnType<typeof makePullRequest>; comments?: Comment[]; issue?: Record<string, unknown>; failGithub?: boolean } = {}) {
  const directory = temporaryDirectory();
  const configDirectory = join(directory, "config");
  const stateDirectory = join(directory, "state");
  const configFile = join(configDirectory, "config.toml");
  const pr = options.pr ?? makePullRequest();
  const comments = options.comments ?? [makeComment("needs-fix")];
  mkdirSync(configDirectory, { recursive: true });
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(configFile, `repositories = ["${REPOSITORY}"]\nreviewer_logins = ["review-bot"]\nrefresh_interval_seconds = 15\n`);
  const environment = {
    HERDR_ENV: "1",
    HERDR_BIN_PATH: "herdr-test",
    HERDR_PLUGIN_ID: "tracer.review-gate-watcher",
    TRACER_REVIEWER_LOGINS: "review-bot",
    HERDR_PLUGIN_CONFIG_DIR: configDirectory,
    HERDR_PLUGIN_STATE_DIR: stateDirectory,
  } as NodeJS.ProcessEnv;
  const calls: { executable: string; args: string[] }[] = [];
  const runner: CommandRunner = (executable, args) => {
    calls.push({ executable, args });
    if (options.failGithub && executable === "gh") return result("", 1, "GitHub unavailable");
    if (executable === "herdr-test" && args[0] === "plugin" && args[1] === "list") {
      return result(JSON.stringify({ result: { plugins: [{ plugin_id: "tracer.review-gate-watcher", enabled: true }] } }));
    }
    if (executable === "herdr-test" && args[0] === "notification") return result(JSON.stringify({ result: { shown: true } }));
    if (executable === "git") return result("https://github.com/acme/repo.git\n");
    if (executable !== "gh") return result("", 1, "unexpected command");
    if (args[0] === "pr" && args[1] === "list") return result(JSON.stringify([pr]));
    if (args[0] === "pr" && args[1] === "view") return result(JSON.stringify(pr));
    if (args[0] === "issue" && args[1] === "view") return result(JSON.stringify(options.issue ?? {
      state: "OPEN",
      title: "Improve the API",
      body: "Autonomy: AFK-safe",
      labels: [],
    }));
    if (args[0] === "api" && args[1].endsWith("/comments")) return result(commentApi(comments));
    if (args[0] === "api" && args[1].includes("/compare/")) {
      return result(JSON.stringify([{ status: "ahead", ahead_by: 1, files: [{ filename: "src/api.ts" }] }]));
    }
    return result("", 1, `unexpected GitHub args: ${args.join(" ")}`);
  };
  const snapshot = async () => ({
    protocol: 22,
    workspaces: [{ worktree: { repo_root: "/repo", checkout_path: "/repo", repo_key: "github.com/acme/repo.git", repo_name: "repo" } }],
    panes: [],
    agents: [],
  });
  const dependencies: WatcherDependencies = { commandRunner: runner, snapshot, logger: () => {} };
  return { directory, configDirectory, configFile, stateDirectory, environment, calls, runner, dependencies, pr, comments };
}

describe("validateConfig", () => {
  test("normalizes reviewer logins and validates unique watched repositories", () => {
    expect(validateConfig({ repositories: [REPOSITORY], reviewer_logins: [" Review-Bot "], refresh_interval_seconds: 30 })).toEqual({
      repositories: [REPOSITORY],
      reviewer_logins: ["review-bot"],
      refresh_interval_seconds: 30,
    });
    expect(() => validateConfig({ repositories: [], reviewer_logins: REVIEWER_LOGINS })).toThrow("non-empty");
    expect(() => validateConfig({ repositories: [REPOSITORY, "ACME/REPO"], reviewer_logins: REVIEWER_LOGINS })).toThrow("unique");
    expect(() => validateConfig({ repositories: [REPOSITORY], reviewer_logins: [" "] })).toThrow("reviewer_logins");
    expect(() => validateConfig({ repositories: ["not-a-repository"], reviewer_logins: REVIEWER_LOGINS })).toThrow("owner/repo");
    expect(() => validateConfig({ repositories: [REPOSITORY], reviewer_logins: REVIEWER_LOGINS, refresh_interval_seconds: 1 })).toThrow("refresh_interval_seconds");
    const testCase = harness();
    testCase.environment.TRACER_REVIEWER_LOGINS = "Review-Bot, trusted-reviewer";
    expect(configuredRepositories(testCase.environment).reviewer_logins).toEqual(["review-bot"]);
    delete testCase.environment.TRACER_REVIEWER_LOGINS;
    expect(() => configuredRepositories(testCase.environment)).toThrow("TRACER_REVIEWER_LOGINS");
  });
});

describe("Herdr snapshot and watched repositories", () => {
  test("accepts the Herdr 0.9.5 snapshot envelope and fails closed on unsupported protocol", () => {
    expect(parseSnapshot(JSON.stringify({ result: { type: "session_snapshot", snapshot: { protocol: 22, workspaces: [], panes: [], agents: [] } } }))).toMatchObject({ protocol: 22 });
    expect(() => parseSnapshot(JSON.stringify({ result: { type: "session_snapshot", snapshot: { protocol: 21, workspaces: [], panes: [], agents: [] } } }))).toThrow("unsupported");
  });

  test("watches only repositories represented by one live Herdr workspace and rejects ambiguity", async () => {
    const snapshot = {
      protocol: 22,
      workspaces: [{ worktree: { repo_root: "/repo", checkout_path: "/repo", repo_key: "github.com/acme/repo.git", repo_name: "repo" } }],
      panes: [],
      agents: [],
    };
    const commandRunner: CommandRunner = (_executable, args) => result(args[2] === "/repo-copy" ? "git@github.com:acme/repo.git\n" : "https://github.com/acme/repo.git\n");
    expect(watchedRepositories(snapshot, CONFIG, commandRunner)).toEqual([{ repository: REPOSITORY, repositoryRoots: ["/repo"] }]);
    expect(watchedRepositories({ ...snapshot, workspaces: [] }, CONFIG, commandRunner)).toEqual([]);
    expect(watchedRepositories({ ...snapshot, workspaces: [...snapshot.workspaces, { worktree: { ...snapshot.workspaces[0].worktree, checkout_path: "/repo-copy", repo_root: "/repo" } }] }, CONFIG, commandRunner)).toHaveLength(1);
    const noActivity = harness();
    await reconcile(noActivity.environment, { ...noActivity.dependencies, snapshot: async () => ({ protocol: 22, workspaces: [], panes: [], agents: [] }) });
    expect(noActivity.calls.some(({ executable, args }) => executable === "gh" && args[0] === "pr")).toBe(false);
  });

  test("reads a snapshot from the live Herdr CLI without opening another process", async () => {
    const snapshot = { protocol: 22, workspaces: [], panes: [], agents: [] };
    const live = await readHerdrSnapshot({ HERDR_BIN_PATH: "herdr-test" } as NodeJS.ProcessEnv, () => result(JSON.stringify({ result: { type: "session_snapshot", snapshot } })));
    expect(live).toEqual(snapshot);
  });
});

describe("governingIssueIsHitl", () => {
  test("stops for HITL labels, title markers, and explicit human autonomy", () => {
    expect(governingIssueIsHitl({ state: "OPEN", title: "[HITL] Change public behavior", body: "", labels: [] })).toBe(true);
    expect(governingIssueIsHitl({ state: "OPEN", title: "Human decision", body: "Autonomy: needs human", labels: [] })).toBe(true);
    expect(governingIssueIsHitl({ state: "OPEN", title: "Task", body: "", labels: [{ name: "needs-human" }] })).toBe(true);
  });

  test("does not mistake an AFK-safe issue for human-owned work", () => {
    expect(governingIssueIsHitl({ state: "OPEN", title: "Task", body: "Autonomy: AFK-safe", labels: [{ name: "ready-for-agent" }] })).toBe(false);
  });

  test("fails closed on missing, unknown, and hyphenated human autonomy declarations", () => {
    expect(governingIssueIsHitl({ state: "OPEN", title: "Task", body: "", labels: [] })).toBe(true);
    expect(governingIssueIsHitl({ state: "OPEN", title: "Task", body: "Autonomy: undecided", labels: [] })).toBe(true);
    expect(governingIssueIsHitl({ state: "OPEN", title: "Task", body: "Autonomy: needs-human", labels: [] })).toBe(true);
  });
});

describe("pullRequestDecision and notificationCandidate", () => {
  test("reuses the shared current-head eligibility decision for needs-fix", () => {
    const decision = pullRequestDecision(REPOSITORY, makePullRequest(), [makeComment("needs-fix")], REVIEWER_LOGINS, () => result());
    expect(decision).toMatchObject({ kind: "dispatch", verdict: { verdict: "needs-fix", headSha: HEAD_SHA } });
    expect(notificationCandidate(REPOSITORY, makePullRequest(), decision)).toEqual({
      key: `${REPOSITORY}#98:${HEAD_SHA}:needs-fix`,
      title: `Review Gate needs a fix: ${REPOSITORY}#98`,
      body: `${PULL_REQUEST_URL}\nManual action: from-pr-review ${PULL_REQUEST_URL}`,
    });
  });

  test("notifies needs-human with the exact verdict next action", () => {
    const pr = makePullRequest({ labels: [{ name: "gate:needs-human" }] });
    const decision = pullRequestDecision(REPOSITORY, pr, [makeComment("needs-human")], REVIEWER_LOGINS, () => result());
    expect(notificationCandidate(REPOSITORY, pr, decision)?.body).toBe(`${PULL_REQUEST_URL}\nNext action: gh pr view 98 --web`);
  });

  test.each([
    ["stale SHA", makeComment("needs-fix", { headSha: PREVIOUS_SHA })],
    ["untrusted author", makeComment("needs-fix", { author: "unknown-reviewer" })],
    ["malformed marker", makeComment("needs-fix", { body: `## review-gate: malformed`, createdAt: "2026-11-16T00:00:00Z" })],
  ])("fails closed on %s", (_label, comment) => {
    const decision = pullRequestDecision(REPOSITORY, makePullRequest(), [comment], REVIEWER_LOGINS, () => result());
    expect(decision.kind).toBe("stop");
    expect(notificationCandidate(REPOSITORY, makePullRequest(), decision)).toBeNull();
  });

  test("fails closed on missing allowlist and disagreement between labels and verdict", () => {
    expect(pullRequestDecision(REPOSITORY, makePullRequest(), [makeComment("needs-fix")], [], () => result())).toMatchObject({ kind: "stop", reason: "missing-allowlist" });
    const mismatched = makePullRequest({ labels: [{ name: "gate:needs-human" }] });
    expect(pullRequestDecision(REPOSITORY, mismatched, [makeComment("needs-fix")], REVIEWER_LOGINS, () => result())).toMatchObject({ kind: "stop", reason: "verdict-label-mismatch" });
  });

  test("stops actionable needs-fix at the corrective-round circuit breaker", () => {
    const comments = [
      makeComment("needs-fix", { headSha: PREVIOUS_SHA, round: 0, createdAt: "2026-11-10T00:00:00Z", body: `## review-gate: needs-fix\nhead-sha: ${PREVIOUS_SHA}\nreview-round: 0\nreviewed-files: 1\nblocking-set: src/api.ts\nrebaseline: yes\nnext-action: from-pr-review ${PULL_REQUEST_URL}\n` }),
      makeComment("needs-fix", { headSha: MIDDLE_SHA, round: 1, createdAt: "2026-11-11T00:00:00Z", body: `## review-gate: needs-fix\nhead-sha: ${MIDDLE_SHA}\nreview-round: 1\nreviewed-files: 1\nblocking-set: src/api.ts\nnext-action: from-pr-review ${PULL_REQUEST_URL}\n` }),
      makeComment("needs-fix", { headSha: "dddddddddddddddddddddddddddddddddddddddd", round: 2, createdAt: "2026-11-12T00:00:00Z", body: `## review-gate: needs-fix\nhead-sha: dddddddddddddddddddddddddddddddddddddddd\nreview-round: 2\nreviewed-files: 1\nblocking-set: src/api.ts\nnext-action: from-pr-review ${PULL_REQUEST_URL}\n` }),
      makeComment("needs-fix", { round: 3, createdAt: "2026-11-13T00:00:00Z", body: `## review-gate: needs-fix\nhead-sha: ${HEAD_SHA}\nreview-round: 3\nreviewed-files: 1\nblocking-set: src/api.ts\nnext-action: from-pr-review ${PULL_REQUEST_URL}\n` }),
    ];
    const comparison = JSON.stringify([{ status: "ahead", ahead_by: 1, files: [{ filename: "src/api.ts" }] }]);
    const comparisons = new Map([
      [`repos/${REPOSITORY}/compare/${PREVIOUS_SHA}...${MIDDLE_SHA}`, comparison],
      [`repos/${REPOSITORY}/compare/${MIDDLE_SHA}...dddddddddddddddddddddddddddddddddddddddd`, comparison],
      [`repos/${REPOSITORY}/compare/dddddddddddddddddddddddddddddddddddddddd...${HEAD_SHA}`, comparison],
    ]);
    const runner: CommandRunner = (_executable, args) => result(comparisons.get(args[1]) ?? "[]");
    const decision = pullRequestDecision(REPOSITORY, makePullRequest(), comments, REVIEWER_LOGINS, runner);
    expect(decision).toMatchObject({ kind: "stop", reason: "circuit-breaker" });
  });
});

describe("reconcile", () => {
  test("sends one needs-fix notification, persists its key, and does not launch work", async () => {
    const testCase = harness();
    await reconcile(testCase.environment, testCase.dependencies);
    await reconcile(testCase.environment, testCase.dependencies);
    const notices = testCase.calls.filter(({ executable, args }) => executable === "herdr-test" && args[0] === "notification");
    expect(notices).toHaveLength(1);
    expect(notices[0].args).toContain(`https://github.com/acme/repo/pull/98\nManual action: from-pr-review ${PULL_REQUEST_URL}`);
    expect(testCase.calls.every(({ args }) => !args.some((argument) => argument === "pane" || argument === "agent" || argument === "crush"))).toBe(true);
    expect(JSON.parse(readFileSync(join(testCase.stateDirectory, "notified.json"), "utf8"))).toEqual({ notified: [`${REPOSITORY}#98:${HEAD_SHA}:needs-fix`] });
  });

  test("sends the needs-human next-action once without dispatch", async () => {
    const testCase = harness({ pr: makePullRequest({ labels: [{ name: "gate:needs-human" }] }), comments: [makeComment("needs-human")] });
    await reconcile(testCase.environment, testCase.dependencies);
    const notice = testCase.calls.find(({ executable, args }) => executable === "herdr-test" && args[0] === "notification");
    expect(notice?.args).toContain(`${PULL_REQUEST_URL}\nNext action: gh pr view 98 --web`);
  });

  test("stops on HITL PRs and HITL governing issues without notifying", async () => {
    const hitlPr = harness({ pr: makePullRequest({ labels: [{ name: "HITL" }, { name: "gate:needs-fix" }] }) });
    await reconcile(hitlPr.environment, hitlPr.dependencies);
    const hitlIssue = harness({ issue: { state: "OPEN", title: "[HITL] Change behavior", body: "", labels: [] } });
    await reconcile(hitlIssue.environment, hitlIssue.dependencies);
    expect([...hitlPr.calls, ...hitlIssue.calls].filter(({ executable, args }) => executable === "herdr-test" && args[0] === "notification")).toHaveLength(0);
  });

  test("does not notify for a governing issue with no autonomy declaration", async () => {
    const undeclaredIssue = harness({ issue: { state: "OPEN", title: "Improve the API", body: "", labels: [] } });
    await reconcile(undeclaredIssue.environment, undeclaredIssue.dependencies);
    expect(undeclaredIssue.calls.filter(({ executable, args }) => executable === "herdr-test" && args[0] === "notification")).toHaveLength(0);
  });

  test("does not notify when GitHub fails or Herdr is unavailable", async () => {
    const unavailableGithub = harness({ failGithub: true });
    await reconcile(unavailableGithub.environment, unavailableGithub.dependencies);
    expect(unavailableGithub.calls.filter(({ executable, args }) => executable === "herdr-test" && args[0] === "notification")).toHaveLength(0);
    const unavailableHerdr = harness();
    const dependencies = { ...unavailableHerdr.dependencies, snapshot: async () => { throw new Error("Herdr unavailable"); } };
    await expect(reconcile(unavailableHerdr.environment, dependencies)).rejects.toThrow("Herdr unavailable");
    expect(unavailableHerdr.calls.filter(({ executable, args }) => executable === "herdr-test" && args[0] === "notification")).toHaveLength(0);
  });

  test("does not duplicate the same head and verdict after a transient verdict change and return", async () => {
    const testCase = harness();
    await reconcile(testCase.environment, testCase.dependencies);
    const returnedHead = "cccccccccccccccccccccccccccccccccccccccc";
    const middleHead = "dddddddddddddddddddddddddddddddddddddddd";
    const oldestHead = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const originalRunner = testCase.dependencies.commandRunner as CommandRunner;
    let currentPr = testCase.pr;
    let commentHead = currentPr.headRefOid;
    const runner: CommandRunner = (executable, args) => {
      if (executable === "gh" && args[0] === "pr" && (args[1] === "list" || args[1] === "view")) return result(JSON.stringify(args[1] === "list" ? [currentPr] : currentPr));
      if (executable === "gh" && args[0] === "api" && args[1].endsWith("/comments")) {
        const history = commentHead === HEAD_SHA
          ? [makeComment("needs-fix", { headSha: oldestHead, createdAt: "2026-11-10T00:00:00Z", body: `## review-gate: needs-fix\nhead-sha: ${oldestHead}\nreview-round: 0\nreviewed-files: 1\nblocking-set: src/api.ts\nrebaseline: yes\nnext-action: from-pr-review ${PULL_REQUEST_URL}\n` }), makeComment("needs-fix", { headSha: middleHead, round: 1, createdAt: "2026-11-11T00:00:00Z" }), makeComment("needs-fix", { headSha: HEAD_SHA, round: 2 })]
          : [makeComment("needs-fix", { headSha: commentHead })];
        return result(commentApi(history));
      }
      if (executable === "gh" && args[0] === "api" && args[1].includes("/compare/")) {
        return result(JSON.stringify([{ status: "ahead", ahead_by: 1, files: [{ filename: "README.md" }] }]));
      }
      return originalRunner(executable, args);
    };
    const updatedDependencies = { ...testCase.dependencies, commandRunner: runner };
    currentPr = makePullRequest({ headRefOid: middleHead });
    commentHead = middleHead;
    await reconcile(testCase.environment, updatedDependencies);
    currentPr = makePullRequest({ headRefOid: returnedHead });
    commentHead = returnedHead;
    await reconcile(testCase.environment, updatedDependencies);
    currentPr = testCase.pr;
    commentHead = HEAD_SHA;
    await reconcile(testCase.environment, updatedDependencies);
    const notices = testCase.calls.filter(({ executable, args }) => executable === "herdr-test" && args[0] === "notification");
    expect(notices).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(testCase.stateDirectory, "notified.json"), "utf8")).notified).toEqual([
      `${REPOSITORY}#98:${HEAD_SHA}:needs-fix`,
      `${REPOSITORY}#98:${middleHead}:needs-fix`,
      `${REPOSITORY}#98:${returnedHead}:needs-fix`,
    ]);
  });
});

describe("watch lifecycle", () => {
  test("reconciles while the plugin is enabled and exits when it is disabled", async () => {
    const testCase = harness();
    let enabledChecks = 0;
    let pauses = 0;
    await watch(testCase.environment, {
      ...testCase.dependencies,
      pluginEnabled: () => ++enabledChecks <= 2,
      waitForEvent: async (milliseconds) => { pauses += 1; expect(milliseconds).toBe(15_000); return null; },
    });
    expect(pauses).toBe(1);
    expect(testCase.calls.some(({ executable, args }) => executable === "gh" && args[0] === "pr" && args[1] === "list")).toBe(true);
  });

  test("exits when Herdr shuts down instead of leaving a watcher behind", async () => {
    const testCase = harness();
    const loggerMessages: string[] = [];
    await watch(testCase.environment, {
      ...testCase.dependencies,
      pluginEnabled: () => false,
      snapshot: async () => { throw new Error("Herdr session is unavailable"); },
      waitForEvent: async () => { throw new Error("event stream closed"); },
      logger: (message) => loggerMessages.push(message),
    });
    expect(loggerMessages).toHaveLength(0);
  });

  test("does not poll or notify when launched outside Herdr", async () => {
    const testCase = harness();
    delete testCase.environment.HERDR_ENV;
    await expect(watch(testCase.environment, testCase.dependencies)).rejects.toThrow("active Herdr plugin context");
    expect(testCase.calls).toHaveLength(0);
  });
});
