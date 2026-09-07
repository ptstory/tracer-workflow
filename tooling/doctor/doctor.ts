#!/usr/bin/env bun

import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";

type Severity = "error" | "warning";

type DoctorFinding = {
  component: string;
  expected: string;
  observed: string;
  severity: Severity;
  action: string;
};

type DoctorReport = {
  repoRoot: string;
  repoRoots: string[];
  findings: DoctorFinding[];
  summary: {
    errors: number;
    warnings: number;
  };
};

type ParsedArgs = {
  json: boolean;
  canonicalRepoRoot: string;
  repoRoots: string[];
  home: string;
};

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

type DoctorDeps = {
  runCommand?: (command: string, args: string[]) => CommandResult;
};

type SkillContract = {
  name: string | null;
  heading: string | null;
};

const EXPECTED_SKILL_NAME = "next";
const EXPECTED_SKILL_HEADING = "Next";
const EXPECTED_WORKFLOW_POINTER = "setup-matt-pocock-skills";
const EXPECTED_LABELS = [
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
  "bug",
  "enhancement",
] as const;

const LAUNCHD_TARGETS = [
  {
    component: "launchd:com.tracer.unbacked-work-monitor.plist",
    plist: "tooling/unbacked-work-monitor/com.tracer.unbacked-work-monitor.plist",
    script: "tooling/unbacked-work-monitor/unbacked-work-monitor.ts",
  },
  {
    component: "launchd:com.tracer.review-gate-poller.plist",
    plist: "tooling/review-gate-poller/com.tracer.review-gate-poller.plist",
    script: "tooling/review-gate-poller/poller.ts",
  },
] as const;

function getCanonicalCheckoutRoot(repoRoot: string): string {
  const worktreeMatch = repoRoot.match(/^(.*)\/\.slim\/worktrees\/[^/]+$/);
  return worktreeMatch ? worktreeMatch[1] : repoRoot;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): ParsedArgs {
  const repoRoots: string[] = [];
  const envRoots = splitList(process.env.TRACER_DOCTOR_REPO_ROOTS);
  let home = process.env.HOME ?? "";
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--repo-root") {
      const value = argv[++i];
      if (!value) throw new Error("--repo-root requires a path");
      repoRoots.push(resolve(value));
      continue;
    }
    if (arg === "--home") {
      const value = argv[++i];
      if (!value) throw new Error("--home requires a path");
      home = resolve(value);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    repoRoots.push(resolve(arg));
  }

  if (repoRoots.length === 0) repoRoots.push(...envRoots.map((root) => resolve(root)));

  return {
    json,
    repoRoots,
    canonicalRepoRoot: resolve(process.cwd()),
    home: home ? resolve(home) : resolve(process.env.HOME ?? process.cwd()),
  };
}

function parseSkillContract(text: string): SkillContract {
  const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---\n?/);
  let name: string | null = null;
  if (frontmatterMatch) {
    for (const line of frontmatterMatch[1].split("\n")) {
      const match = line.match(/^name:\s*(.+)$/);
      if (match) {
        name = match[1].trim();
        break;
      }
    }
  }

  const headingMatch = text.match(/^#\s+(.+)$/m);
  return {
    name,
    heading: headingMatch ? headingMatch[1].trim() : null,
  };
}

function finding(component: string, expected: string, observed: string, severity: Severity, action: string): DoctorFinding {
  return { component, expected, observed, severity, action };
}

function inspectionObserved(path: string, error: unknown): string {
  return `filesystem inspection failed at ${path}: ${(error as Error).message}`;
}

function inspectionFinding(component: string, expected: string, observed: string, action: string): DoctorFinding {
  return finding(component, expected, observed, "error", action);
}

function readTextFile(path: string, component: string, expected: string, action: string): { text: string | null; finding: DoctorFinding | null } {
  try {
    return { text: readFileSync(path, "utf8"), finding: null };
  } catch (error) {
    return {
      text: null,
      finding: inspectionFinding(component, expected, inspectionObserved(path, error), action),
    };
  }
}

function realpathOrFinding(path: string, component: string, expected: string, action: string): { path: string | null; finding: DoctorFinding | null } {
  try {
    return { path: realpathSync(path), finding: null };
  } catch (error) {
    return {
      path: null,
      finding: inspectionFinding(component, expected, inspectionObserved(path, error), action),
    };
  }
}

function parsePlistEnvironmentVariables(text: string): Record<string, string> {
  const match = text.match(/<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/m);
  if (!match) return {};

  return Object.fromEntries(
    [...match[1].matchAll(/<key>(.*?)<\/key>\s*<string>(.*?)<\/string>/g)].map((entry) => [entry[1], entry[2]]),
  );
}

function findExecutableOnPath(command: string, pathValue: string | undefined): string | null {
  if (!pathValue) return null;

  for (const segment of pathValue.split(":")) {
    if (!segment) continue;
    const candidate = join(segment, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseGithubRepoSlug(remoteUrl: string): string | null {
  const normalized = remoteUrl.trim().replace(/\.git$/, "");
  const match = normalized.match(/github\.com[:/](?<owner>[^/\s]+)\/(?<repo>[^/\s]+)$/);
  const owner = match?.groups?.owner;
  const repo = match?.groups?.repo;
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

function resolveRepoSlug(repoRoot: string, deps: DoctorDeps = {}): string | null {
  const result = (deps.runCommand ?? runCommand)("git", ["-C", repoRoot, "config", "--get", "remote.origin.url"]);
  if (result.status !== 0) return null;
  return parseGithubRepoSlug(result.stdout);
}

function checkRepoGitHubLabels(repoRoot: string, deps: DoctorDeps = {}): DoctorFinding[] {
  try {
    const repoSlug = resolveRepoSlug(repoRoot, deps);
    if (!repoSlug) {
      return [
        finding(
          `repo-label-slug:${repoRoot}`,
          `resolve a GitHub repo slug from ${repoRoot}`,
          "remote.origin.url missing or not a github.com repo",
          "error",
          "Point the origin remote at a GitHub slug.",
        ),
      ];
    }

    const result = (deps.runCommand ?? runCommand)("gh", ["label", "list", "--repo", repoSlug, "--limit", "100", "--json", "name"]);
    if (result.status !== 0) {
      const observed = [result.stderr.trim(), result.stdout.trim(), `exit status ${result.status ?? "unknown"}`].filter(Boolean).join("; ");
      return [
        finding(
          `repo-label-access:${repoRoot}`,
          `read-only gh label list succeeds for ${repoSlug}`,
          `gh label list failed: ${observed}`,
          "error",
          "Inspect GitHub CLI access for this repo.",
        ),
      ];
    }

    let labels: unknown;
    try {
      labels = JSON.parse(result.stdout);
    } catch (error) {
      return [
        finding(
          `repo-label-access:${repoRoot}`,
          `read-only gh label list returns JSON for ${repoSlug}`,
          `could not parse gh output: ${(error as Error).message}`,
          "error",
          "Inspect gh label output for this repo.",
        ),
      ];
    }

    const observedLabels = Array.isArray(labels)
      ? labels
          .map((item) => (item && typeof item === "object" && "name" in item ? String((item as { name?: unknown }).name) : null))
          .filter((name): name is string => Boolean(name))
      : [];
    const missingLabels = [...EXPECTED_LABELS].filter((label) => !observedLabels.includes(label));
    if (missingLabels.length === 0) return [];

    return [
      finding(
        `repo-labels:${repoRoot}`,
        `canonical GitHub labels: ${EXPECTED_LABELS.join(", ")}`,
        `missing labels: ${missingLabels.join(", ")}`,
        "error",
        "Add the missing GitHub labels to the repository.",
      ),
    ];
  } catch (error) {
    return [
      finding(
        `repo-label-access:${repoRoot}`,
        `read-only gh label list succeeds for ${repoRoot}`,
        `label access check threw: ${(error as Error).message}`,
        "error",
        "Inspect repository access for this repo.",
      ),
    ];
  }
}

function checkNextSkill(repoRoot: string): DoctorFinding[] {
  const skillPath = join(repoRoot, "skills/next/SKILL.md");
  if (!existsSync(skillPath)) {
    return [
      finding(
        "skill:next",
        `skills/next/SKILL.md identifies the ${EXPECTED_SKILL_NAME} role`,
        "missing skills/next/SKILL.md",
        "error",
        "Restore skills/next/SKILL.md.",
      ),
    ];
  }

  const read = readTextFile(skillPath, "skill:next", "skills/next/SKILL.md identifies the next role", "Restore skills/next/SKILL.md.");
  if (read.finding) return [read.finding];

  const contract = parseSkillContract(read.text ?? "");
  const observed = `frontmatter name=${contract.name ?? "<missing>"}; heading=${contract.heading ?? "<missing>"}`;
  if (contract.name === EXPECTED_SKILL_NAME && contract.heading === EXPECTED_SKILL_HEADING) return [];

  return [
    finding(
      "skill:next",
      `${EXPECTED_SKILL_NAME} frontmatter + ${EXPECTED_SKILL_HEADING} heading`,
      observed,
      "error",
      "Restore the canonical next skill.",
    ),
  ];
}

function checkNoAiSlopSkill(repoRoot: string): DoctorFinding[] {
  const skillPath = join(repoRoot, "skills/no-ai-slop/SKILL.md");
  if (!existsSync(skillPath)) {
    return [
      finding(
        "skill:no-ai-slop",
        "skills/no-ai-slop/SKILL.md identifies the no-ai-slop role",
        "missing skills/no-ai-slop/SKILL.md",
        "error",
        "Restore skills/no-ai-slop/SKILL.md.",
      ),
    ];
  }

  const read = readTextFile(skillPath, "skill:no-ai-slop", "skills/no-ai-slop/SKILL.md identifies the no-ai-slop role", "Restore skills/no-ai-slop/SKILL.md.");
  if (read.finding) return [read.finding];

  const contract = parseSkillContract(read.text ?? "");
  const observed = `frontmatter name=${contract.name ?? "<missing>"}; heading=${contract.heading ?? "<missing>"}`;
  if (contract.name === "no-ai-slop" && contract.heading === "No AI slop") return [];

  return [
    finding(
      "skill:no-ai-slop",
      "no-ai-slop frontmatter + No AI slop heading",
      observed,
      "error",
      "Restore the canonical no-ai-slop skill.",
    ),
  ];
}

function checkRuntimeSkillWiring(repoRoot: string, home: string): DoctorFinding[] {
  const canonicalRepoRoot = getCanonicalCheckoutRoot(repoRoot);
  const findings: DoctorFinding[] = [];

  for (const skillSlug of ["next", "no-ai-slop"] as const) {
    const expectedPath = join(canonicalRepoRoot, `skills/${skillSlug}`);
    const component = `runtime-skill:${skillSlug}`;
    const runtimePath = join(home, ".agents/skills", skillSlug);
    const expectedResolution = existsSync(expectedPath)
      ? realpathOrFinding(
        expectedPath,
        component,
        `directory symlink at ${runtimePath} resolves to ${expectedPath}`,
        "Restore the canonical skill path.",
      )
      : { path: expectedPath, finding: null };
    if (expectedResolution.finding) {
      findings.push(expectedResolution.finding);
      continue;
    }

    const expected = expectedResolution.path ?? expectedPath;

    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(runtimePath);
    } catch {
      findings.push(
        finding(
          component,
          `directory symlink at ${runtimePath} resolves to ${expected}`,
          "missing runtime skill directory symlink",
          "error",
          `Create a symlink from ${runtimePath} to ${expected}.`,
        ),
      );
      continue;
    }

    if (!stat.isSymbolicLink()) {
      let resolved: string;
      try {
        resolved = realpathSync(runtimePath);
      } catch (error) {
        findings.push(
          inspectionFinding(
            component,
            `directory symlink at ${runtimePath} resolves to ${expected}`,
            inspectionObserved(runtimePath, error),
            `Restore ${runtimePath}.`,
          ),
        );
        continue;
      }
      findings.push(
        finding(
          component,
          `directory symlink at ${runtimePath} resolves to ${expected}`,
          `not a symlink; realpath=${resolved}`,
          "error",
          `Point ${runtimePath} at ${expected}.`,
        ),
      );
      continue;
    }

    let resolved: string;
    try {
      resolved = realpathSync(runtimePath);
    } catch {
      findings.push(
        finding(
          component,
          `directory symlink at ${runtimePath} resolves to ${expected}`,
          `missing symlink target for ${runtimePath}`,
          "error",
          `Restore ${runtimePath}.`,
        ),
      );
      continue;
    }

    if (resolved !== expected) {
      findings.push(
        finding(
          component,
          `directory symlink at ${runtimePath} resolves to ${expected}`,
          `resolved to ${resolved}`,
          "error",
          `Point ${runtimePath} at ${expected}.`,
        ),
      );
    }
  }

  return findings;
}

function checkVerdictContract(repoRoot: string): DoctorFinding[] {
  const path = join(repoRoot, "skills/review-gate/references/verdict-contract.md");
  if (!existsSync(path)) {
    return [
      finding(
        "contract:review-gate-verdict",
        "verdict-contract.md exists and documents the review-gate marker",
        "missing verdict-contract.md",
        "error",
        "Restore the canonical review-gate contract marker file.",
      ),
    ];
  }

  const read = readTextFile(path, "contract:review-gate-verdict", "verdict-contract.md documents the marker and head-sha rules", "Restore the review-gate verdict contract text.");
  if (read.finding) return [read.finding];

  const text = read.text ?? "";
  const hasMarker = text.includes("## review-gate:");
  const hasHeadSha = text.includes("head-sha:");
  if (hasMarker && hasHeadSha) return [];

  const missing = [!hasMarker ? "## review-gate:" : null, !hasHeadSha ? "head-sha:" : null].filter(Boolean).join(", ");
  return [
    finding(
      "contract:review-gate-verdict",
      "verdict-contract.md documents the marker and head-sha rules",
      `missing ${missing}`,
      "error",
      "Restore the review-gate verdict contract text.",
    ),
  ];
}

function checkRepoContract(repoRoot: string): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const agentsPath = join(repoRoot, "AGENTS.md");
  const workflowPath = join(repoRoot, "WORKFLOW.md");

  if (!existsSync(agentsPath)) {
    findings.push(
      finding(
        `repo-contract:${basename(repoRoot)}`,
        "AGENTS.md exists and carries the canonical label mapping",
        "AGENTS.md is missing",
        "error",
        "Add the repo's AGENTS.md pointer/label contract using setup-matt-pocock-skills.",
      ),
    );
  } else {
    const agentsRead = readTextFile(
      agentsPath,
      `repo-contract:${basename(repoRoot)}`,
      `AGENTS.md lists canonical labels: ${EXPECTED_LABELS.join(", ")}`,
      "Restore the AGENTS.md label contract.",
    );
    if (agentsRead.finding) {
      findings.push(agentsRead.finding);
    } else {
      const agents = agentsRead.text ?? "";
      const missingLabels = [...EXPECTED_LABELS].filter((label) => !agents.includes(label));
      if (missingLabels.length > 0) {
        findings.push(
          finding(
            `repo-contract:${basename(repoRoot)}`,
            `AGENTS.md lists canonical labels: ${EXPECTED_LABELS.join(", ")}`,
            `missing labels: ${missingLabels.join(", ")}`,
            "error",
            "Restore the canonical label mapping in AGENTS.md.",
          ),
        );
      }
    }
  }

  if (!existsSync(workflowPath)) {
    findings.push(
      finding(
        `repo-contract:${basename(repoRoot)}`,
        `WORKFLOW.md mentions ${EXPECTED_WORKFLOW_POINTER}`,
        "WORKFLOW.md is missing",
        "error",
        "Restore the repo workflow pointer contract.",
      ),
    );
  } else {
    const workflowRead = readTextFile(
      workflowPath,
      `repo-contract:${basename(repoRoot)}`,
      `WORKFLOW.md mentions ${EXPECTED_WORKFLOW_POINTER}`,
      "Restore the workflow pointer contract.",
    );
    if (workflowRead.finding) {
      findings.push(workflowRead.finding);
    } else {
      const workflow = workflowRead.text ?? "";
      if (!workflow.includes(EXPECTED_WORKFLOW_POINTER)) {
        findings.push(
          finding(
            `repo-contract:${basename(repoRoot)}`,
            `WORKFLOW.md mentions ${EXPECTED_WORKFLOW_POINTER}`,
            "pointer text missing",
            "error",
            "Add the setup-matt-pocock-skills pointer to WORKFLOW.md.",
          ),
        );
      }
    }
  }

  return findings;
}

function parsePlistProgramArguments(text: string): string[] {
  const programArgumentsMatch = text.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/m);
  if (!programArgumentsMatch) return [];

  return [...programArgumentsMatch[1].matchAll(/<string>(.*?)<\/string>/g)].map((match) => match[1]);
}

function checkLaunchdPath(repoRoot: string, home: string, plistRelativePath: string, scriptRelativePath: string, component: string): DoctorFinding[] {
  const plistPath = join(repoRoot, plistRelativePath);
  const installedPlistPath = join(home, "Library/LaunchAgents", basename(plistRelativePath));
  if (!existsSync(installedPlistPath)) {
    return [
      finding(
        component,
        `installed plist at ${installedPlistPath} points to ${join(getCanonicalCheckoutRoot(repoRoot), scriptRelativePath)}`,
        existsSync(plistPath) ? `missing effective installed plist at ${installedPlistPath}` : `missing effective installed plist at ${installedPlistPath}; checked-in template is also missing`,
        "error",
        `Install ${plistPath} at ${installedPlistPath}.`,
      ),
    ];
  }

  const canonicalRepoRoot = getCanonicalCheckoutRoot(repoRoot);
  const scriptPath = join(canonicalRepoRoot, scriptRelativePath);
  const installed = readTextFile(
    installedPlistPath,
    component,
    `installed plist at ${installedPlistPath} points to ${scriptPath}`,
    `Restore ${installedPlistPath}.`,
  );
  if (installed.finding) return [installed.finding];

  const text = installed.text ?? "";
  const args = parsePlistProgramArguments(text);
  const launcher = args[0];
  const observed = args[1];
  const environment = parsePlistEnvironmentVariables(text);
  const findings: DoctorFinding[] = [];

  const template = existsSync(plistPath)
    ? readTextFile(
        plistPath,
        component,
        `checked-in plist at ${plistPath} documents the launchd launcher and script surface`,
        `Restore ${plistPath}.`,
      )
    : null;
  if (template?.finding) findings.push(template.finding);
  const expectedArgs = template?.text ? parsePlistProgramArguments(template.text) : [];
  const expectedLauncher = expectedArgs[0];

  if (launcher) {
    const launcherExists = existsSync(launcher);
    const launcherExpected = expectedLauncher || launcher;
    if (launcher === launcherExpected) {
      if (!launcherExists) {
        findings.push(
          finding(
            component,
            `ProgramArguments[0] resolves to ${launcherExpected}`,
            `configured launcher missing at ${launcher}`,
            "error",
            `Restore ${launcherExpected}.`,
          ),
        );
      } else {
        try {
          accessSync(launcher, constants.X_OK);
        } catch {
          findings.push(
            finding(
              component,
              `ProgramArguments[0] resolves to ${launcherExpected}`,
              `configured launcher is not executable at ${launcher}`,
              "error",
              `Restore ${launcherExpected}.`,
            ),
          );
        }
      }
    } else if (launcherExists) {
      findings.push(
        finding(
          component,
          `ProgramArguments[0] resolves to ${launcherExpected}`,
          `stale configured launcher path ${launcher}`,
          "warning",
          `Point ProgramArguments[0] at ${launcherExpected}.`,
        ),
      );
    } else {
      findings.push(
        finding(
          component,
          `ProgramArguments[0] resolves to ${launcherExpected}`,
          `configured launcher missing at ${launcher}`,
          "error",
          `Restore ${launcherExpected}.`,
        ),
      );
    }
  } else {
    findings.push(
      finding(
        component,
        `ProgramArguments[0] resolves to ${expectedLauncher || "an executable launcher"}`,
        `configured plist is missing ProgramArguments[0] in ${installedPlistPath}`,
        "error",
        `Point ProgramArguments[0] at ${expectedLauncher || "a real launcher"}.`,
      ),
    );
  }

  if (observed) {
    if (observed === scriptPath) {
      if (!existsSync(scriptPath)) {
        findings.push(
          finding(
            component,
            `ProgramArguments[1] resolves to ${scriptPath}`,
            `configured target script missing at ${scriptPath}`,
            "error",
            `Restore ${scriptPath}.`,
          ),
        );
      }
    } else if (existsSync(observed)) {
      findings.push(
        finding(
          component,
          `ProgramArguments[1] resolves to ${scriptPath}`,
          `stale configured path ${observed}`,
          "warning",
          `Point ${installedPlistPath} at ${scriptPath}.`,
        ),
      );
    } else {
      findings.push(
        finding(
          component,
          `ProgramArguments[1] resolves to ${scriptPath}`,
          `configured target script missing at ${observed}`,
          "error",
          `Restore ${observed}.`,
        ),
      );
    }
  } else {
    findings.push(
      finding(
        component,
        `ProgramArguments[1] resolves to ${scriptPath}`,
        `configured plist is missing ProgramArguments[1] in ${installedPlistPath}`,
        "error",
        `Point ProgramArguments[1] at ${scriptPath}.`,
      ),
    );
  }

  if (component === "launchd:com.tracer.review-gate-poller.plist") {
    const workdir = environment.RG_WORKDIR;
    if (!workdir) {
      findings.push(
        finding(
          component,
          "EnvironmentVariables.RG_WORKDIR names a directory",
          "missing EnvironmentVariables.RG_WORKDIR",
          "error",
          "Point RG_WORKDIR at a real directory.",
        ),
      );
    } else {
      try {
        const resolvedWorkdir = realpathSync(workdir);
        if (!lstatSync(resolvedWorkdir).isDirectory()) {
          findings.push(
            finding(
              component,
              "EnvironmentVariables.RG_WORKDIR names a directory",
              `EnvironmentVariables.RG_WORKDIR=${workdir} resolves to ${resolvedWorkdir} which is not a directory`,
              "error",
              "Point RG_WORKDIR at a real directory.",
            ),
          );
        }
      } catch (error) {
        findings.push(
          inspectionFinding(
            component,
            "EnvironmentVariables.RG_WORKDIR names a directory",
            `EnvironmentVariables.RG_WORKDIR=${workdir}; ${(error as Error).message}`,
            "Point RG_WORKDIR at a real directory.",
          ),
        );
      }
    }

    const requiredExecutables = ["opencode", "gh", "git"];
    for (const executableName of requiredExecutables) {
      const executable = findExecutableOnPath(executableName, environment.PATH);
      if (!executable) {
        findings.push(
          finding(
            component,
            `EnvironmentVariables.PATH exposes an executable ${executableName}`,
            `PATH=${environment.PATH ?? "<missing>"}`,
            "error",
            `Add ${executableName} to PATH.`,
          ),
        );
      }
    }
  }

  return findings;
}

function buildDoctorReport(repoRootsOrCanonicalRoot: string[] | string, downstreamRepoRootsOrHome: string[] | string, homeOrDeps: string | DoctorDeps = {}, deps: DoctorDeps = {}): DoctorReport {
  const canonicalRepoRoot = Array.isArray(repoRootsOrCanonicalRoot)
    ? (repoRootsOrCanonicalRoot[0] ?? resolve(process.cwd()))
    : repoRootsOrCanonicalRoot;
  const repoRoots = Array.isArray(repoRootsOrCanonicalRoot)
    ? repoRootsOrCanonicalRoot
    : [repoRootsOrCanonicalRoot, ...(Array.isArray(downstreamRepoRootsOrHome) ? downstreamRepoRootsOrHome : [])].filter(Boolean);
  const home = Array.isArray(repoRootsOrCanonicalRoot)
    ? (downstreamRepoRootsOrHome as string)
    : (homeOrDeps as string);
  const resolvedDeps = Array.isArray(repoRootsOrCanonicalRoot)
    ? (homeOrDeps as DoctorDeps)
    : deps;
  const mainRepoRoot = canonicalRepoRoot;
  const allRepoRoots = [...new Set(repoRoots.length > 0 ? repoRoots : [mainRepoRoot])];
  const findings = [
    ...checkNextSkill(mainRepoRoot),
    ...checkNoAiSlopSkill(mainRepoRoot),
    ...checkRuntimeSkillWiring(mainRepoRoot, home),
    ...checkVerdictContract(mainRepoRoot),
    ...allRepoRoots.flatMap((repoRoot) => checkRepoContract(repoRoot)),
    ...allRepoRoots.flatMap((repoRoot) => checkRepoGitHubLabels(repoRoot, resolvedDeps)),
    ...LAUNCHD_TARGETS.flatMap((target) => checkLaunchdPath(mainRepoRoot, home, target.plist, target.script, target.component)),
  ];

  const summary = findings.reduce(
    (acc, item) => {
      if (item.severity === "error") acc.errors += 1;
      if (item.severity === "warning") acc.warnings += 1;
      return acc;
    },
    { errors: 0, warnings: 0 },
  );

  return {
    repoRoot: mainRepoRoot,
    repoRoots: allRepoRoots,
    findings,
    summary,
  };
}

function renderDoctorText(report: DoctorReport): string {
  if (report.findings.length === 0) return "tracer doctor: clean\n";

  const lines = [`tracer doctor: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s)`];
  for (const item of report.findings) {
    lines.push(`- [${item.severity}] ${item.component}`);
    lines.push(`  expected: ${item.expected}`);
    lines.push(`  observed: ${item.observed}`);
    lines.push(`  action: ${item.action}`);
  }
  return `${lines.join("\n")}\n`;
}

function runCli(argv: string[]): number {
  try {
    const parsed = parseArgs(argv);
    const report = buildDoctorReport(parsed.canonicalRepoRoot, parsed.repoRoots, parsed.home);

    if (parsed.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(renderDoctorText(report));
    }

    return report.summary.errors > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  }
}

if (import.meta.main) {
  process.exitCode = runCli(Bun.argv.slice(2));
}

export {
  buildDoctorReport,
  checkLaunchdPath,
  checkNextSkill,
  checkRepoGitHubLabels,
  checkRepoContract,
  checkRuntimeSkillWiring,
  checkVerdictContract,
  parseArgs,
  parseGithubRepoSlug,
  parsePlistProgramArguments,
  parseSkillContract,
  renderDoctorText,
  resolveRepoSlug,
  runCli,
};
export type { CommandResult, DoctorDeps, DoctorFinding, DoctorReport, ParsedArgs, Severity };
