#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, type Dirent } from "node:fs";
import { dirname, join, resolve } from "node:path";

type Classification =
  | "clean"
  | "local-only-commits-found"
  | "no-trusted-remote-configured-or-found"
  | "remote-fetch-failed"
  | "repository-inspect-failed";

type Retainer =
  | { kind: "ref"; name: string }
  | { kind: "worktree"; path: string; detached: boolean };

type CommitFinding = {
  commit: string;
  shortCommit: string;
  subject: string;
  committedAt: string;
  ageDays: number;
  retainers: Retainer[];
};

type RepoReport = {
  repoPath: string;
  classification: Classification;
  trustedRemotes: string[];
  configuredTrustedRemotes: string[];
  remoteRefs: string[];
  findings: CommitFinding[];
  error?: string;
};

type FleetReport = {
  repos: RepoReport[];
  counts: {
    reposScanned: number;
    clean: number;
    localOnly: number;
    noTrustedRemote: number;
    fetchFailed: number;
    inspectFailed: number;
  };
};

type Tip = {
  commit: string;
  retainers: Retainer[];
};

type ParsedArgs = {
  roots: string[];
  trustedRemotes: string[];
  outputDir: string;
};

const DEFAULT_TRUSTED_REMOTES = ["origin"];
const DEFAULT_ROOTS = ["/Users/perrystory/Code/vibecoding", "/Users/perrystory/Code/corby"];
const DEFAULT_OUTPUT_DIR = `${process.env.HOME ?? ""}/.local/state/tracer/unbacked-work`;
const DEFAULT_OUTPUT_JSON = "scan.json";
const DEFAULT_OUTPUT_MD = "attention.md";

function runGit(repoPath: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return (result.stdout ?? "").trim();
}

function runGitResult(repoPath: string, args: string[]): { ok: true; stdout: string } | { ok: false; error: string } {
  try {
    return { ok: true, stdout: runGit(repoPath, args) };
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, error: (err.stderr ?? err.stdout ?? err.message ?? String(error)).trim() };
  }
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function expandHome(pathValue: string): string {
  if (pathValue.startsWith("~")) {
    return join(process.env.HOME ?? "", pathValue.slice(1));
  }
  return pathValue;
}

function discoverRepoRoot(candidatePath: string): string | null {
  let current = resolve(candidatePath);
  while (true) {
    if (existsSync(join(current, ".git"))) break;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }

  const out = runGitResult(candidatePath, ["rev-parse", "--show-toplevel"]);
  if (!out.ok) return null;
  return out.stdout.trim();
}

function discoverReposUnderRoot(root: string): string[] {
  const discovered = new Set<string>();
  const visited = new Set<string>();

  function walk(candidatePath: string): void {
    const absolutePath = resolve(candidatePath);
    if (visited.has(absolutePath)) return;
    visited.add(absolutePath);

    const repoRoot = discoverRepoRoot(absolutePath);
    if (repoRoot) {
      discovered.add(repoRoot);
      return;
    }

    let entries: Dirent[];
    try {
      entries = readdirSync(absolutePath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === ".git" || entry.name.endsWith(".git")) continue;
      walk(join(absolutePath, entry.name));
    }
  }

  walk(resolve(root));
  return [...discovered].sort((a, b) => a.localeCompare(b));
}

function discoverReposUnderRoots(roots: string[]): string[] {
  return [...new Set(roots.flatMap((root) => discoverReposUnderRoot(root)))].sort((a, b) => a.localeCompare(b));
}

function parseArgs(argv: string[]): ParsedArgs {
  const roots: string[] = [];
  let outputDir = process.env.UNBACKED_WORK_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR;
  let trustedRemotes = splitList(process.env.UNBACKED_WORK_TRUSTED_REMOTES);
  if (trustedRemotes.length === 0) trustedRemotes = [...DEFAULT_TRUSTED_REMOTES];
  const rootsEnv = splitList(process.env.UNBACKED_WORK_ROOTS ?? process.env.UNBACKED_WORK_REPOS);
  const rootsFile = process.env.UNBACKED_WORK_ROOTS_FILE ?? process.env.UNBACKED_WORK_REPOS_FILE;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--roots" || arg === "--repos") {
      const value = argv[++i];
      if (!value) throw new Error("--roots requires a comma or newline separated value");
      roots.push(...splitList(value));
      continue;
    }
    if (arg === "--roots-file" || arg === "--repos-file") {
      const value = argv[++i];
      if (!value) throw new Error("--roots-file requires a path");
      roots.push(...splitList(readFileSync(value, "utf8")));
      continue;
    }
    if (arg === "--trusted-remotes") {
      const value = argv[++i];
      if (!value) throw new Error("--trusted-remotes requires a comma or newline separated value");
      trustedRemotes = splitList(value);
      continue;
    }
    if (arg === "--output-dir") {
      const value = argv[++i];
      if (!value) throw new Error("--output-dir requires a path");
      outputDir = value;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    roots.push(arg);
  }

  if (roots.length === 0 && rootsFile) roots.push(...splitList(readFileSync(rootsFile, "utf8")));
  if (roots.length === 0) roots.push(...rootsEnv);
  if (roots.length === 0) roots.push(...DEFAULT_ROOTS);

  return {
    roots: roots.map((root) => resolve(expandHome(root))),
    trustedRemotes,
    outputDir: expandHome(outputDir),
  };
}

function listConfiguredRemotes(repoPath: string): string[] {
  const out = runGitResult(repoPath, ["remote"]);
  if (!out.ok) throw new Error(out.error);
  return splitList(out.stdout);
}

function fetchTrustedRemotes(repoPath: string, trustedRemotes: string[]): { configured: string[]; error?: string } {
  const configured = listConfiguredRemotes(repoPath).filter((remote) => trustedRemotes.includes(remote));
  if (configured.length === 0) return { configured };

  for (const remote of configured) {
    const out = runGitResult(repoPath, ["fetch", "--prune", "--no-tags", remote]);
    if (!out.ok) {
      return { configured, error: `${remote}: ${out.error}` };
    }
  }

  return { configured };
}

function listRemoteRefs(repoPath: string, remotes: string[]): string[] {
  const refs: string[] = [];
  for (const remote of remotes) {
    const out = runGitResult(repoPath, ["for-each-ref", `refs/remotes/${remote}`, "--format=%(objectname)"]);
    if (!out.ok) throw new Error(out.error);
    refs.push(...splitList(out.stdout));
  }
  return [...new Set(refs)].sort();
}

function listWorktrees(repoPath: string): Array<{ path: string; head: string; branch?: string; detached: boolean }> {
  const out = runGitResult(repoPath, ["worktree", "list", "--porcelain"]);
  if (!out.ok) throw new Error(out.error);

  const worktrees: Array<{ path: string; head: string; branch?: string; detached: boolean }> = [];
  let current: { path: string; head: string; branch?: string; detached: boolean } | null = null;

  for (const line of out.stdout.split("\n")) {
    if (!line) continue;
    if (line.startsWith("worktree ")) {
      if (current) worktrees.push(current);
      current = { path: line.slice("worktree ".length), head: "", detached: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
      continue;
    }
    if (line.startsWith("branch ")) {
      current.branch = line.slice("branch refs/heads/".length);
      continue;
    }
    if (line === "detached") current.detached = true;
  }

  if (current) worktrees.push(current);
  return worktrees.sort((a, b) => a.path.localeCompare(b.path));
}

function listLocalBranchTips(repoPath: string): Array<{ name: string; commit: string }> {
  const out = runGitResult(repoPath, ["for-each-ref", "refs/heads", "--format=%(refname:short)%09%(objectname)"]);
  if (!out.ok) throw new Error(out.error);
  return splitList(out.stdout)
    .map((line) => {
      const [name, commit] = line.split("\t");
      return { name, commit };
    })
    .filter((entry) => entry.name && entry.commit)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildTips(repoPath: string): Tip[] {
  const worktrees = listWorktrees(repoPath);
  const branchToWorktree = new Map<string, string>();
  const detachedHeads: Array<{ path: string; head: string }> = [];

  for (const worktree of worktrees) {
    if (worktree.branch) branchToWorktree.set(worktree.branch, worktree.path);
    if (worktree.detached) detachedHeads.push({ path: worktree.path, head: worktree.head });
  }

  const tips: Tip[] = [];
  for (const branch of listLocalBranchTips(repoPath)) {
    const retainers: Retainer[] = [{ kind: "ref", name: branch.name }];
    const attachedWorktree = branchToWorktree.get(branch.name);
    if (attachedWorktree) retainers.push({ kind: "worktree", path: attachedWorktree, detached: false });
    tips.push({ commit: branch.commit, retainers });
  }

  for (const detached of detachedHeads) {
    tips.push({
      commit: detached.head,
      retainers: [{ kind: "worktree", path: detached.path, detached: true }],
    });
  }

  return tips.sort((a, b) => a.commit.localeCompare(b.commit) || JSON.stringify(a.retainers).localeCompare(JSON.stringify(b.retainers)));
}

function listLocalOnlyCommits(repoPath: string, remoteRefs: string[], tips: Tip[]): Map<string, Set<string>> {
  const retained = new Map<string, Set<string>>();
  const remoteArgs = remoteRefs.length > 0 ? ["--not", ...remoteRefs] : [];

  for (const tip of tips) {
    const out = runGitResult(repoPath, ["rev-list", tip.commit, ...remoteArgs]);
    if (!out.ok) throw new Error(out.error);
    for (const commit of splitList(out.stdout)) {
      if (!retained.has(commit)) retained.set(commit, new Set<string>());
      for (const retainer of tip.retainers) {
        retained.get(commit)!.add(retainerKey(retainer));
      }
    }
  }

  return retained;
}

function retainerKey(retainer: Retainer): string {
  return retainer.kind === "ref" ? `ref:${retainer.name}` : `worktree:${retainer.path}:${retainer.detached ? "detached" : "attached"}`;
}

function decodeRetainerKey(key: string): Retainer {
  if (key.startsWith("ref:")) return { kind: "ref", name: key.slice("ref:".length) };
  const [_, path, mode] = key.split(":");
  return { kind: "worktree", path, detached: mode === "detached" };
}

function loadCommitFinding(repoPath: string, commit: string, retainerKeys: Set<string>): { commit: string; shortCommit: string; subject: string; committedAt: string; committedAtEpoch: number; retainers: Retainer[] } {
  const metaOut = runGitResult(repoPath, ["show", "-s", "--format=%H%x00%s%x00%ct%x00%cI", commit]);
  if (!metaOut.ok) throw new Error(metaOut.error);

  const [fullCommit, subject, committedAtEpochText, committedAt] = metaOut.stdout.split("\u0000");
  const committedAtEpoch = Number(committedAtEpochText);

  return {
    commit: fullCommit,
    shortCommit: fullCommit.slice(0, 12),
    subject,
    committedAt,
    committedAtEpoch,
    retainers: [...retainerKeys].sort().map(decodeRetainerKey),
  };
}

function inspectRepo(repoPath: string, trustedRemotes: string[], nowMs = Date.now()): RepoReport {
  const fetch = fetchTrustedRemotes(repoPath, trustedRemotes);
  if (fetch.configured.length === 0) {
    return {
      repoPath,
      classification: "no-trusted-remote-configured-or-found",
      trustedRemotes: [...trustedRemotes],
      configuredTrustedRemotes: [],
      remoteRefs: [],
      findings: [],
    };
  }
  if (fetch.error) {
    return {
      repoPath,
      classification: "remote-fetch-failed",
      trustedRemotes: [...trustedRemotes],
      configuredTrustedRemotes: fetch.configured,
      remoteRefs: [],
      findings: [],
      error: fetch.error,
    };
  }

  const remoteRefs = listRemoteRefs(repoPath, fetch.configured);
  if (remoteRefs.length === 0) {
    return {
      repoPath,
      classification: "no-trusted-remote-configured-or-found",
      trustedRemotes: [...trustedRemotes],
      configuredTrustedRemotes: fetch.configured,
      remoteRefs: [],
      findings: [],
    };
  }

  const tips = buildTips(repoPath);
  const localOnly = listLocalOnlyCommits(repoPath, remoteRefs, tips);
  const rawFindings = [...localOnly.entries()].map(([commit, retainerKeys]) => loadCommitFinding(repoPath, commit, retainerKeys));
  const findings = rawFindings
    .sort((a, b) => b.committedAtEpoch - a.committedAtEpoch || a.commit.localeCompare(b.commit))
    .map(({ committedAtEpoch, ...finding }) => ({
      ...finding,
      ageDays: Math.floor((nowMs - committedAtEpoch * 1000) / 86400000),
    }));

  return {
    repoPath,
    classification: findings.length > 0 ? "local-only-commits-found" : "clean",
    trustedRemotes: [...trustedRemotes],
    configuredTrustedRemotes: fetch.configured,
    remoteRefs,
    findings,
  };
}

function scanFleet(repoPaths: string[], trustedRemotes: string[], nowMs = Date.now()): FleetReport {
  const repos = repoPaths.map((repoPath) => {
    try {
      return inspectRepo(repoPath, trustedRemotes, nowMs);
    } catch (error) {
      return {
        repoPath,
        classification: "repository-inspect-failed" as const,
        trustedRemotes: [...trustedRemotes],
        configuredTrustedRemotes: [],
        remoteRefs: [],
        findings: [],
        error: (error as Error).message,
      };
    }
  });

  const counts = repos.reduce(
    (acc, repo) => {
      acc.reposScanned += 1;
      if (repo.classification === "clean") acc.clean += 1;
      if (repo.classification === "local-only-commits-found") acc.localOnly += 1;
      if (repo.classification === "no-trusted-remote-configured-or-found") acc.noTrustedRemote += 1;
      if (repo.classification === "remote-fetch-failed") acc.fetchFailed += 1;
      if (repo.classification === "repository-inspect-failed") acc.inspectFailed += 1;
      return acc;
    },
    { reposScanned: 0, clean: 0, localOnly: 0, noTrustedRemote: 0, fetchFailed: 0, inspectFailed: 0 },
  );

  return {
    repos: repos.sort((a, b) => a.repoPath.localeCompare(b.repoPath)),
    counts,
  };
}

function scanRoots(roots: string[], trustedRemotes: string[], nowMs = Date.now()): FleetReport {
  return scanFleet(discoverReposUnderRoots(roots), trustedRemotes, nowMs);
}

function formatRetainer(retainer: Retainer): string {
  return retainer.kind === "ref"
    ? `ref:${retainer.name}`
    : `worktree:${retainer.path}${retainer.detached ? " (detached)" : ""}`;
}

function renderAttentionMarkdown(report: FleetReport): string {
  const noisyRepos = report.repos
    .filter((repo) => repo.classification !== "clean")
    .sort((a, b) => {
      const aPriority = a.classification === "local-only-commits-found" ? 0 : 1;
      const bPriority = b.classification === "local-only-commits-found" ? 0 : 1;
      return aPriority - bPriority || a.repoPath.localeCompare(b.repoPath);
    });
  if (noisyRepos.length === 0) return "";

  const lines: string[] = ["# Unbacked work monitor"];

  for (const repo of noisyRepos) {
    if (repo.classification === "local-only-commits-found") {
      const newest = repo.findings[0];
      const newestSuffix = newest
        ? ` (newest ${newest.shortCommit} ${newest.subject} — ${newest.committedAt} / ${newest.ageDays}d old)`
        : "";
      lines.push(`- ${repo.repoPath}: ${repo.findings.length} local-only commit${repo.findings.length === 1 ? "" : "s"}${newestSuffix}`);
      for (const finding of repo.findings) {
        const retainers = finding.retainers.map(formatRetainer).join(", ");
        lines.push(`  - ${finding.shortCommit} ${finding.subject} — ${finding.committedAt} (${finding.ageDays}d old)`);
        lines.push(`    - retainers: ${retainers}`);
      }
      continue;
    }

    lines.push(`- ${repo.repoPath}: ${repo.classification}${repo.error ? ` — ${repo.error}` : ""}`);
  }

  return `${lines.join("\n")}\n`;
}

function ensureOutputDir(outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
}

function writeOutputs(report: FleetReport, outputDir: string): { jsonPath: string; markdownPath: string; markdown: string } {
  ensureOutputDir(outputDir);
  const jsonPath = join(outputDir, DEFAULT_OUTPUT_JSON);
  const markdownPath = join(outputDir, DEFAULT_OUTPUT_MD);
  const markdown = renderAttentionMarkdown(report);

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, markdown);

  return { jsonPath, markdownPath, markdown };
}

function runCli(argv: string[]): number {
  const parsed = parseArgs(argv);

  try {
    const report = scanRoots(parsed.roots, parsed.trustedRemotes);
    const outputs = writeOutputs(report, parsed.outputDir);
    if (outputs.markdown) process.stdout.write(outputs.markdown);
    return 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = runCli(Bun.argv.slice(2));
}

export {
  buildTips,
  formatRetainer,
  discoverReposUnderRoot,
  discoverReposUnderRoots,
  inspectRepo,
  listConfiguredRemotes,
  listLocalBranchTips,
  listLocalOnlyCommits,
  listRemoteRefs,
  listWorktrees,
  parseArgs,
  renderAttentionMarkdown,
  runCli,
  scanFleet,
  scanRoots,
  writeOutputs,
};
