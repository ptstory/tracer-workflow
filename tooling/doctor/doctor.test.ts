import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildDoctorReport, renderDoctorText } from "./doctor";

const CANONICAL_LABELS = [
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
  "bug",
  "enhancement",
];
const CANONICAL_REMOTE_URL = "git@github.com:ptstory/tracer-workflow.git";
type DoctorFixture = { remoteUrl: string; labels: string[]; ghFailure?: string };

const sandboxDirs: string[] = [];

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "tracer-doctor-"));
  sandboxDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (sandboxDirs.length > 0) {
    rmSync(sandboxDirs.pop()!, { recursive: true, force: true });
  }
});

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function writeExecutable(path: string, content: string): void {
  writeText(path, content);
  chmodSync(path, 0o755);
}

function writePlist(path: string, scriptPath: string): void {
  writeText(
    path,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>${scriptPath}</string>
  </array>
</dict>
</plist>
`,
  );
}

function writeSkills(repoRoot: string, nextSkillContents: string): void {
  writeText(join(repoRoot, "skills/next/SKILL.md"), nextSkillContents);
  writeText(
    join(repoRoot, "skills/review-gate/references/verdict-contract.md"),
    "# review-gate verdict contract\n\n## review-gate: <state>\nhead-sha: 0123456789abcdef0123456789abcdef01234567\n",
  );
}

function writeContracts(repoRoot: string): void {
  writeText(
    join(repoRoot, "AGENTS.md"),
    `# AGENTS

needs-triage
needs-info
ready-for-agent
ready-for-human
wontfix
bug
enhancement
`,
  );
  writeText(join(repoRoot, "WORKFLOW.md"), `# Workflow

setup-matt-pocock-skills
`);
}

function writeTooling(repoRoot: string): void {
  writePlist(
    join(repoRoot, "tooling/unbacked-work-monitor/com.tracer.unbacked-work-monitor.plist"),
    join(repoRoot, "tooling/unbacked-work-monitor/unbacked-work-monitor.ts"),
  );
  writePlist(
    join(repoRoot, "tooling/review-gate-poller/com.tracer.review-gate-poller.plist"),
    join(repoRoot, "tooling/review-gate-poller/poller.ts"),
  );
}

function writeCleanBaseline(repoRoot: string): void {
  writeSkills(
    repoRoot,
    `---
name: next
description: >
  Pick the next unblocked ready-for-agent issue after merge.
---

# Next

Pick the next ready-for-agent issue.
`,
  );
  writeContracts(repoRoot);
  writeTooling(repoRoot);
}

function slugFromRemoteUrl(remoteUrl: string): string {
  const normalized = remoteUrl.trim().replace(/\.git$/, "");
  const match = normalized.match(/github\.com[:/](?<owner>[^/\s]+)\/(?<repo>[^/\s]+)$/);
  const owner = match?.groups?.owner;
  const repo = match?.groups?.repo;
  if (!owner || !repo) throw new Error(`invalid remote url in test fixture: ${remoteUrl}`);
  return `${owner}/${repo}`;
}

function makeDoctorDeps(fixtures: Record<string, { remoteUrl?: string; labels?: string[]; ghFailure?: string }> = {}) {
  const defaultFixture = {
    remoteUrl: CANONICAL_REMOTE_URL,
    labels: CANONICAL_LABELS,
  };
  const normalizedFixtures = new Map(
    Object.entries(fixtures).map(([repoRoot, fixture]) => [
      repoRoot,
      {
        remoteUrl: fixture.remoteUrl ?? defaultFixture.remoteUrl,
        labels: fixture.labels ?? defaultFixture.labels,
        ghFailure: fixture.ghFailure,
      } as DoctorFixture,
    ] as const),
  );

  const slugFixtures = new Map(
    [
      [slugFromRemoteUrl(defaultFixture.remoteUrl), defaultFixture as DoctorFixture],
      ...[...normalizedFixtures.values()].map((fixture) => [slugFromRemoteUrl(fixture.remoteUrl), fixture] as const),
    ] as const,
  );

  return {
    runCommand(command: string, args: string[]) {
      if (command === "git") {
        const repoRoot = args[1];
        const fixture = normalizedFixtures.get(repoRoot) ?? defaultFixture;
        return { status: 0, stdout: `${fixture.remoteUrl}\n`, stderr: "" };
      }

      if (command === "gh") {
        const repoSlug = args[args.indexOf("--repo") + 1];
        const fixture = slugFixtures.get(repoSlug);
        if (!fixture) return { status: 1, stdout: "", stderr: `unknown repo slug: ${repoSlug}` };
        if (fixture.ghFailure) return { status: 1, stdout: "", stderr: fixture.ghFailure };
        return { status: 0, stdout: JSON.stringify(fixture.labels.map((name) => ({ name }))), stderr: "" };
      }

      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    },
  };
}

function makeRuntimeSymlink(home: string, targetSkillFile: string): void {
  const runtimePath = join(home, ".agents/skills/next/SKILL.md");
  mkdirSync(dirname(runtimePath), { recursive: true });
  symlinkSync(targetSkillFile, runtimePath);
}

function makeRepoRoot(): { repoRoot: string; home: string } {
  const repoRoot = sandbox();
  const home = join(sandbox(), "home");
  mkdirSync(home, { recursive: true });
  return { repoRoot, home };
}

function makeWorktreeRepoRoot(): { canonicalRoot: string; worktreeRoot: string; home: string } {
  const canonicalRoot = sandbox();
  const worktreeRoot = join(canonicalRoot, ".slim/worktrees/issue-36-tracer-doctor");
  mkdirSync(worktreeRoot, { recursive: true });
  const home = join(sandbox(), "home");
  mkdirSync(home, { recursive: true });
  return { canonicalRoot, worktreeRoot, home };
}

test("clean install produces no findings and exits cleanly", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeSkills(
    repoRoot,
    `---
name: next
description: >
  Pick the next unblocked ready-for-agent issue after merge.
---

# Next

Pick the next ready-for-agent issue.
`,
  );
  writeContracts(repoRoot);
  writeTooling(repoRoot);
  makeRuntimeSymlink(home, join(repoRoot, "skills/next/SKILL.md"));

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps());

  expect(report.summary).toEqual({ errors: 0, warnings: 0 });
  expect(report.findings).toEqual([]);
  expect(renderDoctorText(report)).toBe("tracer doctor: clean\n");
});

test("#30/#36 next skill drift is a deterministic error", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeSkills(
    repoRoot,
    `---
name: deliverable-package-finalizer
description: >
  Turn messy implementation state into something that can be handed off or reviewed without explanation.
---

# Deliverable Package Finalizer

Turn messy implementation state into something that can be handed off or reviewed without explanation.
`,
  );
  writeContracts(repoRoot);
  writeTooling(repoRoot);
  makeRuntimeSymlink(home, join(repoRoot, "skills/next/SKILL.md"));

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps());
  const finding = report.findings.find((item: any) => item.component === "skill:next");

  expect(finding).toMatchObject({
    severity: "error",
    expected: "next frontmatter + Next heading",
  });
  expect(finding?.observed).toContain("deliverable-package-finalizer");
  expect(finding?.observed).toContain("Deliverable Package Finalizer");
  expect(report.summary.errors).toBeGreaterThan(0);
});

test("runtime skill symlink target mismatch is reported", () => {
  const clean = makeRepoRoot();
  const other = makeRepoRoot();
  writeSkills(
    clean.repoRoot,
    `---
name: next
description: >
  Pick the next unblocked ready-for-agent issue after merge.
---

# Next

Pick the next ready-for-agent issue.
`,
  );
  writeSkills(
    other.repoRoot,
    `---
name: next
description: >
  Pick the next unblocked ready-for-agent issue after merge.
---

# Next

Pick the next ready-for-agent issue.
`,
  );
  writeContracts(clean.repoRoot);
  writeContracts(other.repoRoot);
  writeTooling(clean.repoRoot);
  writeTooling(other.repoRoot);
  makeRuntimeSymlink(clean.home, join(other.repoRoot, "skills/next/SKILL.md"));

  const report = (buildDoctorReport as any)([clean.repoRoot], clean.home, makeDoctorDeps());
  const finding = report.findings.find((item: any) => item.component === "runtime-skill:next");

  expect(finding).toMatchObject({ severity: "error" });
  expect(finding?.observed).toContain(realpathSync(join(other.repoRoot, "skills/next/SKILL.md")));
});

test("runtime skill wiring and launchd paths accept canonical checkout targets from a worktree", () => {
  const { canonicalRoot, worktreeRoot, home } = makeWorktreeRepoRoot();
  writeSkills(
    canonicalRoot,
    `---
name: next
description: >
  Pick the next unblocked ready-for-agent issue after merge.
---

# Next

Pick the next ready-for-agent issue.
`,
  );
  writeContracts(worktreeRoot);
  writeSkills(
    worktreeRoot,
    `---
name: next
description: >
  Pick the next unblocked ready-for-agent issue after merge.
---

# Next

Pick the next ready-for-agent issue.
`,
  );
  writeTooling(canonicalRoot);
  writeTooling(worktreeRoot);
  makeRuntimeSymlink(home, join(canonicalRoot, "skills/next/SKILL.md"));

  writePlist(
    join(worktreeRoot, "tooling/unbacked-work-monitor/com.tracer.unbacked-work-monitor.plist"),
    join(canonicalRoot, "tooling/unbacked-work-monitor/unbacked-work-monitor.ts"),
  );
  writePlist(
    join(worktreeRoot, "tooling/review-gate-poller/com.tracer.review-gate-poller.plist"),
    join(canonicalRoot, "tooling/review-gate-poller/poller.ts"),
  );

  const report = (buildDoctorReport as any)([worktreeRoot], home, makeDoctorDeps());

  expect(report.summary).toEqual({ errors: 0, warnings: 0 });
  expect(report.findings.some((item: any) => item.component === "runtime-skill:next")).toBe(false);
  expect(report.findings.some((item: any) => item.component === "launchd:com.tracer.unbacked-work-monitor.plist")).toBe(false);
});

test("repo contract failures stay isolated per repo root", () => {
  const clean = makeRepoRoot();
  const bad = makeRepoRoot();
  writeSkills(
    clean.repoRoot,
    `---
name: next
description: >
  Pick the next unblocked ready-for-agent issue after merge.
---

# Next

Pick the next ready-for-agent issue.
`,
  );
  writeSkills(
    bad.repoRoot,
    `---
name: next
description: >
  Pick the next unblocked ready-for-agent issue after merge.
---

# Next

Pick the next ready-for-agent issue.
`,
  );
  writeContracts(clean.repoRoot);
  writeTooling(clean.repoRoot);
  writeTooling(bad.repoRoot);
  makeRuntimeSymlink(clean.home, join(clean.repoRoot, "skills/next/SKILL.md"));

  const report = (buildDoctorReport as any)([clean.repoRoot, bad.repoRoot], clean.home, makeDoctorDeps({
    [clean.repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL },
    [bad.repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL },
  }));
  const repoFinding = report.findings.find((item: any) => item.component.startsWith("repo-contract:"));

  expect(repoFinding?.observed).toBe("AGENTS.md is missing");
  expect(report.findings.some((item: any) => item.component === "skill:next")).toBe(false);
});

test("stale launchd path is warning-only and keeps exit zero", () => {
  const repo = makeRepoRoot();
  const legacy = makeRepoRoot();
  writeSkills(
    repo.repoRoot,
    `---
name: next
description: >
  Pick the next unblocked ready-for-agent issue after merge.
---

# Next

Pick the next ready-for-agent issue.
`,
  );
  writeSkills(
    legacy.repoRoot,
    `---
name: next
description: >
  Pick the next unblocked ready-for-agent issue after merge.
---

# Next

Pick the next ready-for-agent issue.
`,
  );
  writeContracts(repo.repoRoot);
  writeTooling(repo.repoRoot);
  writeTooling(legacy.repoRoot);
  makeRuntimeSymlink(repo.home, join(repo.repoRoot, "skills/next/SKILL.md"));

  const stalePath = join(legacy.repoRoot, "tooling/unbacked-work-monitor/unbacked-work-monitor.ts");
  writeText(stalePath, "console.log('legacy');\n");
  writePlist(
    join(repo.repoRoot, "tooling/unbacked-work-monitor/com.tracer.unbacked-work-monitor.plist"),
    stalePath,
  );

  const report = (buildDoctorReport as any)([repo.repoRoot], repo.home, makeDoctorDeps());
  const finding = report.findings.find((item: any) => item.component === "launchd:com.tracer.unbacked-work-monitor.plist");

  expect(finding).toMatchObject({ severity: "warning" });
  expect(report.summary.errors).toBe(0);
  expect(report.summary.warnings).toBeGreaterThan(0);
});

test("CLI json mode emits structured output", () => {
  const { repoRoot, home } = makeRepoRoot();
  const doctorScript = fileURLToPath(new URL("./doctor.ts", import.meta.url));
  const stubBin = sandbox();
  writeSkills(
    repoRoot,
    `---
name: next
description: >
  Pick the next unblocked ready-for-agent issue after merge.
---

# Next

Pick the next ready-for-agent issue.
`,
  );
  writeContracts(repoRoot);
  writeTooling(repoRoot);
  makeRuntimeSymlink(home, join(repoRoot, "skills/next/SKILL.md"));
  writeExecutable(join(stubBin, "git"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'git@github.com:ptstory/tracer-workflow.git'
`);
  writeExecutable(join(stubBin, "gh"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' '[{"name":"needs-triage"},{"name":"needs-info"},{"name":"ready-for-agent"},{"name":"ready-for-human"},{"name":"wontfix"},{"name":"bug"},{"name":"enhancement"}]'
`);

  const result = spawnSync("bun", [doctorScript, "--json", "--repo-root", repoRoot, "--home", home], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ""}` },
  });

  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).summary).toEqual({ errors: 0, warnings: 0 });
  expect(result.stderr).toBe("");
});

test("missing GitHub labels are reported for a repo with access", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  makeRuntimeSymlink(home, join(repoRoot, "skills/next/SKILL.md"));

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps({
    [repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL, labels: ["needs-triage", "bug", "enhancement"] },
  }));

  const finding = report.findings.find((item: any) => item.component === `repo-labels:${repoRoot}`);

  expect(finding).toMatchObject({
    severity: "error",
    expected: "canonical GitHub labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix, bug, enhancement",
  });
  expect(finding?.observed).toContain("missing labels: needs-info, ready-for-agent, ready-for-human, wontfix");
});

test("GitHub access failure is reported distinctly when repo label lookup fails", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  makeRuntimeSymlink(home, join(repoRoot, "skills/next/SKILL.md"));

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps({
    [repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL, ghFailure: "gh: permission denied\n" },
  }));

  const finding = report.findings.find((item: any) => item.component === `repo-label-access:${repoRoot}`);

  expect(finding).toMatchObject({
    severity: "error",
    expected: "read-only gh label list succeeds for ptstory/tracer-workflow",
  });
  expect(finding?.observed).toContain("gh label list failed");
  expect(finding?.observed).toContain("permission denied");
});

test("one repo failing label access does not block another repo's label comparison", () => {
  const clean = makeRepoRoot();
  const blocked = makeRepoRoot();
  writeCleanBaseline(clean.repoRoot);
  writeCleanBaseline(blocked.repoRoot);
  makeRuntimeSymlink(clean.home, join(clean.repoRoot, "skills/next/SKILL.md"));

  const report = (buildDoctorReport as any)([clean.repoRoot, blocked.repoRoot], clean.home, makeDoctorDeps({
    [clean.repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL },
    [blocked.repoRoot]: { remoteUrl: "git@github.com:ptstory/blocked-repo.git", ghFailure: "gh: unable to reach api\n" },
  }));

  expect(report.findings.some((item: any) => item.component === `repo-labels:${clean.repoRoot}`)).toBe(false);
  expect(report.findings.some((item: any) => item.component === `repo-label-access:${blocked.repoRoot}`)).toBe(true);
});
