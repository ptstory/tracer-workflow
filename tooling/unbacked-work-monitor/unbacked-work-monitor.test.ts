import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";

import { parseArgs, renderAttentionMarkdown, scanRoots, writeOutputs } from "./unbacked-work-monitor";

const sandboxDirs: string[] = [];

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "unbacked-work-monitor-"));
  sandboxDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (sandboxDirs.length > 0) {
    rmSync(sandboxDirs.pop()!, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[], extraEnv: Record<string, string> = {}): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...extraEnv,
      GIT_AUTHOR_NAME: "Tracer Test",
      GIT_AUTHOR_EMAIL: "tracer@example.com",
      GIT_COMMITTER_NAME: "Tracer Test",
      GIT_COMMITTER_EMAIL: "tracer@example.com",
    },
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }

  return (result.stdout ?? "").trim();
}

function initRepo(repoPath: string): void {
  mkdirSync(repoPath, { recursive: true });
  git(repoPath, ["init", "-b", "main"]);
  git(repoPath, ["config", "user.name", "Tracer Test"]);
  git(repoPath, ["config", "user.email", "tracer@example.com"]);
}

function commitFile(repoPath: string, relativePath: string, contents: string, message: string, date?: string): string {
  const fullPath = join(repoPath, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, contents);
  git(repoPath, ["add", relativePath]);
  const dateEnv = date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : undefined;
  git(repoPath, ["commit", "-m", message], dateEnv);
  return git(repoPath, ["rev-parse", "HEAD"]);
}

function bareRemote(baseDir: string, name: string): string {
  const remotePath = join(baseDir, `${name}.git`);
  const result = spawnSync("git", ["init", "--bare", "-b", "main", remotePath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "git init --bare failed").trim());
  return remotePath;
}

function addRemote(repoPath: string, name: string, remotePath: string): void {
  git(repoPath, ["remote", "add", name, remotePath]);
}

function pushBranch(repoPath: string, remote: string, branch = "main"): void {
  git(repoPath, ["push", "-u", remote, branch]);
}

function createCleanRepo(baseDir: string, remoteName = "origin", repoName = `repo-${remoteName}`): string {
  mkdirSync(baseDir, { recursive: true });
  const repoPath = join(baseDir, repoName);
  initRepo(repoPath);
  const remotePath = bareRemote(baseDir, `${remoteName}-remote`);
  addRemote(repoPath, remoteName, remotePath);
  commitFile(repoPath, "README.md", "base\n", "base");
  pushBranch(repoPath, remoteName);
  return repoPath;
}

test("local branch ahead of origin is reported", () => {
  const baseDir = sandbox();
  const rootsDir = join(baseDir, "roots");
  const repoPath = createCleanRepo(join(rootsDir, "nested"), "origin", "repo-a");
  const aheadCommit = commitFile(repoPath, "ahead.txt", "ahead\n", "ahead");

  const report = scanRoots([rootsDir], ["origin"]);

  expect(report.repos[0].classification).toBe("local-only-commits-found");
  expect(report.repos[0].findings.map((finding) => finding.commit)).toEqual([aheadCommit]);
});

test("discovery stops at repo boundaries", () => {
  const baseDir = sandbox();
  const rootsDir = join(baseDir, "roots");
  const outerRepo = createCleanRepo(join(rootsDir, "nested"), "origin", "repo-outer");
  createCleanRepo(join(outerRepo, "vendor", "inner"), "origin", "repo-inner");

  const report = scanRoots([rootsDir], ["origin"]);

  expect(report.repos.map((repo) => repo.repoPath)).toEqual([realpathSync(outerRepo)]);
});

test("no-upstream branch reachable from another trusted remote ref is not reported", () => {
  const baseDir = sandbox();
  const rootsDir = join(baseDir, "roots");
  const repoPath = join(rootsDir, "nested", "repo-no-upstream-reachable");
  initRepo(repoPath);
  const origin = bareRemote(join(rootsDir, "nested"), "origin");
  const upstream = bareRemote(join(rootsDir, "nested"), "upstream");
  addRemote(repoPath, "origin", origin);
  addRemote(repoPath, "upstream", upstream);
  const sharedCommit = commitFile(repoPath, "shared.txt", "shared\n", "shared");
  pushBranch(repoPath, "origin");
  pushBranch(repoPath, "upstream");
  git(repoPath, ["checkout", "-b", "feature", sharedCommit]);

  const report = scanRoots([rootsDir], ["origin", "upstream"]);

  expect(report.repos[0].classification).toBe("clean");
  expect(report.repos[0].findings).toEqual([]);
});

test("no-upstream unique branch is reported", () => {
  const baseDir = sandbox();
  const rootsDir = join(baseDir, "roots");
  const repoPath = createCleanRepo(join(rootsDir, "nested"), "origin", "repo-a");
  git(repoPath, ["checkout", "-b", "orphan"]);
  const uniqueCommit = commitFile(repoPath, "orphan.txt", "orphan\n", "orphan");

  const report = scanRoots([rootsDir], ["origin"]);

  expect(report.repos[0].classification).toBe("local-only-commits-found");
  expect(report.repos[0].findings.map((finding) => finding.commit)).toEqual([uniqueCommit]);
});

test("detached linked-worktree HEAD unique commit is reported", () => {
  const baseDir = sandbox();
  const rootsDir = join(baseDir, "roots");
  const repoPath = createCleanRepo(join(rootsDir, "nested"), "origin", "repo-a");
  const baseCommit = git(repoPath, ["rev-parse", "HEAD"]);
  const worktreePath = join(baseDir, "linked-detached");
  git(repoPath, ["worktree", "add", "--detach", worktreePath, baseCommit]);
  commitFile(worktreePath, "detached.txt", "detached\n", "detached unique");

  const report = scanRoots([rootsDir], ["origin"]);

  expect(report.repos[0].classification).toBe("local-only-commits-found");
  expect(report.repos[0].findings[0].retainers).toContainEqual({ kind: "worktree", path: realpathSync(worktreePath), detached: true });
});

test("same unique commit retained by multiple local refs is deduped into one finding", () => {
  const baseDir = sandbox();
  const rootsDir = join(baseDir, "roots");
  const repoPath = createCleanRepo(join(rootsDir, "nested"), "origin", "repo-a");
  const uniqueCommit = commitFile(repoPath, "topic.txt", "topic\n", "topic");
  git(repoPath, ["branch", "alias-one", uniqueCommit]);
  git(repoPath, ["branch", "alias-two", uniqueCommit]);

  const report = scanRoots([rootsDir], ["origin"]);

  expect(report.repos[0].classification).toBe("local-only-commits-found");
  expect(report.repos[0].findings).toHaveLength(1);
  expect(report.repos[0].findings[0].retainers).toEqual([
    { kind: "ref", name: "alias-one" },
    { kind: "ref", name: "alias-two" },
    { kind: "ref", name: "main" },
    { kind: "worktree", path: realpathSync(repoPath), detached: false },
  ]);
});

test("no trusted remote is classified explicitly", () => {
  const baseDir = sandbox();
  const rootsDir = join(baseDir, "roots");
  const repoPath = join(rootsDir, "nested", "repo-no-remotes");
  initRepo(repoPath);
  commitFile(repoPath, "README.md", "base\n", "base");

  const report = scanRoots([rootsDir], ["origin"]);

  expect(report.repos[0].classification).toBe("no-trusted-remote-configured-or-found");
});

test("missing configured root fails instead of scanning empty", () => {
  const baseDir = sandbox();
  const missingRoot = join(baseDir, "missing-root");

  expect(() => scanRoots([missingRoot], ["origin"])).toThrow(/configured root/i);
});

test("empty but valid configured root is allowed", () => {
  const baseDir = sandbox();
  const emptyRoot = join(baseDir, "empty-root");
  mkdirSync(emptyRoot, { recursive: true });

  const report = scanRoots([emptyRoot], ["origin"]);

  expect(report.repos).toEqual([]);
  expect(report.counts.reposScanned).toBe(0);
});

test("fetch failure is isolated and scan continues", () => {
  const baseDir = sandbox();
  const rootsDir = join(baseDir, "roots");
  const brokenRepo = join(rootsDir, "nested", "broken-repo");
  initRepo(brokenRepo);
  addRemote(brokenRepo, "origin", join(rootsDir, "nested", "missing-origin.git"));
  commitFile(brokenRepo, "README.md", "broken\n", "broken");

  const cleanRepo = createCleanRepo(join(rootsDir, "other"), "origin", "repo-clean");

  const report = scanRoots([rootsDir], ["origin"]);

  const broken = report.repos.find((repo) => repo.repoPath === realpathSync(brokenRepo))!;
  const clean = report.repos.find((repo) => repo.repoPath === realpathSync(cleanRepo))!;

  expect(broken.classification).toBe("remote-fetch-failed");
  expect(clean.classification).toBe("clean");
});

test("clean fleet produces no attention noise", () => {
  const baseDir = sandbox();
  const rootsDir = join(baseDir, "roots");
  const repoOne = createCleanRepo(join(rootsDir, "alpha"), "origin", "repo-one");
  const repoTwo = createCleanRepo(join(rootsDir, "beta"), "upstream", "repo-two");

  const report = scanRoots([rootsDir], ["origin", "upstream"]);

  expect(renderAttentionMarkdown(report)).toBe("");
});

test("markdown includes abbreviated sha, subject, and newest commit date and age", () => {
  const baseDir = sandbox();
  const rootsDir = join(baseDir, "roots");
  const repoPath = createCleanRepo(join(rootsDir, "nested"), "origin", "repo-a");
  const fixedDate = "2026-07-17T03:00:00Z";
  const uniqueCommit = commitFile(repoPath, "ahead.txt", "ahead\n", "ahead", fixedDate);

  const report = scanRoots([rootsDir], ["origin"], Date.parse(fixedDate));
  const markdown = renderAttentionMarkdown(report);

  expect(report.repos[0].findings[0]).toMatchObject({
    commit: uniqueCommit,
    shortCommit: uniqueCommit.slice(0, 12),
    subject: "ahead",
    committedAt: fixedDate,
    ageDays: 0,
  });
  expect(markdown).toContain(uniqueCommit.slice(0, 12));
  expect(markdown).toContain("ahead");
  expect(markdown).toContain("2026-07-17");
  expect(markdown).toContain("0d old");
});

test("markdown lists local-only repos before repository failures", () => {
  const markdown = renderAttentionMarkdown({
    repos: [
      {
        repoPath: "/tmp/a-failure",
        classification: "remote-fetch-failed",
        trustedRemotes: ["origin"],
        configuredTrustedRemotes: ["origin"],
        remoteRefs: [],
        findings: [],
        error: "fetch failed",
      },
      {
        repoPath: "/tmp/z-local",
        classification: "local-only-commits-found",
        trustedRemotes: ["origin"],
        configuredTrustedRemotes: ["origin"],
        remoteRefs: ["deadbeef"],
        findings: [
          {
            commit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
            shortCommit: "deadbeefdead",
            subject: "local work",
            committedAt: "2026-07-17T03:00:00Z",
            ageDays: 0,
            retainers: [],
          },
        ],
      },
      {
        repoPath: "/tmp/m-no-remote",
        classification: "no-trusted-remote-configured-or-found",
        trustedRemotes: ["origin"],
        configuredTrustedRemotes: [],
        remoteRefs: [],
        findings: [],
      },
    ],
    counts: { reposScanned: 3, clean: 0, localOnly: 1, noTrustedRemote: 1, fetchFailed: 1, inspectFailed: 0 },
  } as any);

  expect(markdown.indexOf("/tmp/z-local")).toBeLessThan(markdown.indexOf("/tmp/a-failure"));
  expect(markdown.indexOf("/tmp/z-local")).toBeLessThan(markdown.indexOf("/tmp/m-no-remote"));
});

test("writes stable json and markdown outputs", () => {
  const baseDir = sandbox();
  const rootsDir = join(baseDir, "roots");
  const repoPath = createCleanRepo(join(rootsDir, "nested"), "origin", "repo-a");
  const report = scanRoots([rootsDir], ["origin"]);
  const outputDir = join(baseDir, "out");

  const outputs = writeOutputs(report, outputDir);

  expect(readFileSync(outputs.jsonPath, "utf8")).toContain(`"classification": "clean"`);
  expect(readFileSync(outputs.markdownPath, "utf8")).toBe("");
});

test("parseArgs reads roots from file env", () => {
  const baseDir = sandbox();
  const rootsFile = join(baseDir, "roots.txt");
  writeFileSync(rootsFile, "/tmp/alpha\n/tmp/beta\n");

  const previousRoots = process.env.UNBACKED_WORK_ROOTS;
  const previousRootsFile = process.env.UNBACKED_WORK_ROOTS_FILE;
  process.env.UNBACKED_WORK_ROOTS = "";
  process.env.UNBACKED_WORK_ROOTS_FILE = rootsFile;

  try {
    const parsed = parseArgs([]);
    expect(parsed.roots).toEqual(["/tmp/alpha", "/tmp/beta"]);
  } finally {
    if (previousRoots === undefined) delete process.env.UNBACKED_WORK_ROOTS;
    else process.env.UNBACKED_WORK_ROOTS = previousRoots;
    if (previousRootsFile === undefined) delete process.env.UNBACKED_WORK_ROOTS_FILE;
    else process.env.UNBACKED_WORK_ROOTS_FILE = previousRootsFile;
  }
});
