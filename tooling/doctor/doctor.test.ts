import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { aggregateTracerAdoptionInvariantVerdicts, buildDoctorReport, evaluateTracerAdoptionState, renderDoctorText } from "./doctor";

const TRACER_ADOPTION_CONTRACT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../tracer-adoption:v1"), "utf8");
const TRACER_ADOPTION_LABELS = (JSON.parse(TRACER_ADOPTION_CONTRACT) as { labels: Array<{ actual: string }> }).labels.map(({ actual }) => actual);
const TRACER_ADOPTION_CONTRACT_DATA = JSON.parse(TRACER_ADOPTION_CONTRACT) as Record<string, unknown> & {
  labels: Array<{ canonical: string; actual: string }>;
  reducers: {
    required: { order: string[]; empty: string };
    advisory: { order: string[]; empty: string };
  };
  state_mapping: {
    required_pass: {
      advisory_pass: string;
      advisory_fail: string;
      advisory_unverifiable_or_conflict: string;
    };
    required_fail: string;
    required_unverifiable_or_conflict: string;
    skipped: string;
  };
  invariants: Array<{ verdicts: Record<string, unknown>; evidence?: string }>;
  repo?: {
    workflow_pointer?: string;
    evidence?: {
      agents?: string;
      workflow?: string;
    };
  };
  github?: { identity?: string; access?: string };
};
const CANONICAL_REMOTE_URL = "git@github.com:ptstory/tracer-workflow.git";
const CANONICAL_NO_AI_SLOP_SKILL = `---
name: no-ai-slop
description: >
  Edit drafts into sharper, more human writing while preserving the writer's voice.
---

# No AI slop

Keep the writer's point and voice.
`;
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

function writePlist(path: string, scriptPath: string, environment: Record<string, string> = {}, launcherPath = "/usr/bin/env"): void {
  const environmentEntries = Object.entries(environment)
    .map(([key, value]) => `    <key>${key}</key>\n    <string>${value}</string>\n`)
    .join("");
  const environmentXml = Object.keys(environment).length > 0
    ? `
    <key>EnvironmentVariables</key>
    <dict>
${environmentEntries}    </dict>
`
    : "";

  writeText(
    path,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>ProgramArguments</key>
  <array>
    <string>${launcherPath}</string>
    <string>${scriptPath}</string>
  </array>
${environmentXml}</dict>
</plist>
`,
  );
}

function writeSkills(repoRoot: string, nextSkillContents: string): void {
  writeText(join(repoRoot, "skills/next/SKILL.md"), nextSkillContents);
  writeText(join(repoRoot, "skills/no-ai-slop/SKILL.md"), CANONICAL_NO_AI_SLOP_SKILL);
  writeText(
    join(repoRoot, "skills/review-gate/references/verdict-contract.md"),
    "# review-gate verdict contract\n\n## review-gate: <state>\nhead-sha: 0123456789abcdef0123456789abcdef01234567\n",
  );
}

function writeContracts(repoRoot: string): void {
  writeText(
    join(repoRoot, "AGENTS.md"),
    `# AGENTS

Label authority: tracer-adoption:v1

The canonical-to-actual label mapping lives in tracer-adoption:v1.
`,
  );
  writeText(join(repoRoot, "WORKFLOW.md"), `# Workflow

setup-matt-pocock-skills
`);
  writeText(join(repoRoot, "tracer-adoption:v1"), TRACER_ADOPTION_CONTRACT);
}

function writeTracerAdoptionContract(repoRoot: string, contract: Record<string, unknown>): void {
  writeText(join(repoRoot, "tracer-adoption:v1"), `${JSON.stringify(contract, null, 2)}\n`);
}

function writeTooling(repoRoot: string): void {
  const launcherPath = join(repoRoot, ".bun/bin/bun");
  writeExecutable(launcherPath, "#!/usr/bin/env bash\nexit 0\n");
  writePlist(
    join(repoRoot, "tooling/unbacked-work-monitor/com.tracer.unbacked-work-monitor.plist"),
    join(repoRoot, "tooling/unbacked-work-monitor/unbacked-work-monitor.ts"),
    {},
    launcherPath,
  );
  writePlist(
    join(repoRoot, "tooling/review-gate-poller/com.tracer.review-gate-poller.plist"),
    join(repoRoot, "tooling/review-gate-poller/poller.ts"),
    {
      RG_REPO: "ptstory/themarkergirl.com",
      RG_WORKDIR: repoRoot,
      PATH: `${join(repoRoot, ".bun/bin")}:/usr/bin:/bin`,
      HOME: repoRoot,
    },
    launcherPath,
  );
  writeText(join(repoRoot, "tooling/unbacked-work-monitor/unbacked-work-monitor.ts"), "#!/usr/bin/env bun\n");
  writeText(join(repoRoot, "tooling/review-gate-poller/poller.ts"), "#!/usr/bin/env bun\n");
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
    labels: TRACER_ADOPTION_LABELS,
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

function makeCanonicalRuntimeSymlinks(home: string, targetSkillDir: string): void {
  const runtimePath = join(home, ".agents/skills/next");
  mkdirSync(dirname(runtimePath), { recursive: true });
  symlinkSync(targetSkillDir, runtimePath, "dir");

  const noAiSlopRuntimePath = join(home, ".agents/skills/no-ai-slop");
  mkdirSync(dirname(noAiSlopRuntimePath), { recursive: true });
  symlinkSync(join(dirname(targetSkillDir), "no-ai-slop"), noAiSlopRuntimePath, "dir");
}

function writeInstalledLaunchdPlist(home: string, plistRelativePath: string, scriptPath: string, launcherPath: string): void {
  writePlist(join(home, "Library/LaunchAgents", basename(plistRelativePath)), scriptPath, {}, launcherPath);
}

function writeInstalledLaunchdTargets(home: string, repoRoot: string, scriptRoot = repoRoot): void {
  const launcherPath = join(scriptRoot, ".bun/bin/bun");
  writeExecutable(launcherPath, "#!/usr/bin/env bash\nexit 0\n");
  writeInstalledLaunchdPlist(home, "tooling/unbacked-work-monitor/com.tracer.unbacked-work-monitor.plist", join(scriptRoot, "tooling/unbacked-work-monitor/unbacked-work-monitor.ts"), launcherPath);
  const opencodeBin = join(home, ".local/bin");
  writeExecutable(join(opencodeBin, "opencode"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(opencodeBin, "gh"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(opencodeBin, "git"), "#!/usr/bin/env bash\nexit 0\n");
  writePlist(
    join(home, "Library/LaunchAgents/com.tracer.review-gate-poller.plist"),
    join(scriptRoot, "tooling/review-gate-poller/poller.ts"),
    {
      RG_REPO: "ptstory/themarkergirl.com",
      RG_WORKDIR: scriptRoot,
      PATH: `${opencodeBin}:/usr/bin:/bin`,
      HOME: home,
    },
    launcherPath,
  );
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
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps());

  expect(report.summary).toEqual({ errors: 0, warnings: 0 });
  expect(report.findings).toEqual([]);
  expect(renderDoctorText(report)).toBe("tracer doctor: clean\n");
});

test("missing tracer-adoption contract is reported distinctly", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  rmSync(join(repoRoot, "tracer-adoption:v1"), { force: true });
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps({
    [repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL, labels: [] },
  }));

  const finding = report.findings.find((item: any) => item.component === "contract:tracer-adoption-v1");

  expect(finding).toMatchObject({
    severity: "error",
    expected: "tracer-adoption:v1 is schema-valid and declares the canonical invariants",
  });
  expect(finding?.observed).toContain("is missing");
});

test("future tracer-adoption schema versions are rejected", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  writeTracerAdoptionContract(repoRoot, { ...TRACER_ADOPTION_CONTRACT_DATA, schema_version: 2 });
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps({
    [repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL, labels: [] },
  }));

  const finding = report.findings.find((item: any) => item.component === "contract:tracer-adoption-v1");

  expect(finding).toMatchObject({
    severity: "error",
    expected: "tracer-adoption:v1 schema_version 1 is required",
  });
  expect(finding?.observed).toContain("unsupported schema_version: 2");
});

test("malformed and schema-invalid tracer-adoption contracts are rejected", () => {
  const cases = [
    {
      content: "{not-json",
      observed: "could not parse tracer-adoption:v1",
    },
    {
      content: JSON.stringify({
        ...TRACER_ADOPTION_CONTRACT_DATA,
        labels: [{ canonical: "needs-triage" }],
      }, null, 2),
      observed: "label entry 0 must include canonical and actual strings",
    },
  ] as const;

  for (const { content, observed } of cases) {
    const { repoRoot, home } = makeRepoRoot();
    writeCleanBaseline(repoRoot);
    writeText(join(repoRoot, "tracer-adoption:v1"), content);
    makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
    writeInstalledLaunchdTargets(home, repoRoot);

    const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps({
      [repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL, labels: [] },
    }));

    const finding = report.findings.find((item: any) => item.component === "contract:tracer-adoption-v1");

    expect(finding).toBeTruthy();
    expect(finding).toMatchObject({
      severity: "error",
      expected: "tracer-adoption:v1 is schema-valid and declares the canonical invariants",
    });
    expect(finding?.observed).toContain(observed);
  }
});


test("missing tracer-adoption verdict keys are rejected with a structured contract error", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  writeText(join(repoRoot, "tracer-adoption:v1"), JSON.stringify({
    ...TRACER_ADOPTION_CONTRACT_DATA,
    invariants: TRACER_ADOPTION_CONTRACT_DATA.invariants.map((invariant, index) => index === 0
      ? { ...invariant, verdicts: (({ conflict, ...verdicts }) => verdicts)(invariant.verdicts) }
      : invariant),
  }, null, 2));
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps({
    [repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL, labels: [] },
  }));

  const finding = report.findings.find((item: any) => item.component === "contract:tracer-adoption-v1");

  expect(finding).toBeTruthy();
  expect(finding).toMatchObject({
    severity: "error",
    expected: "tracer-adoption:v1 declares stable invariants",
  });
  expect(finding?.observed).toContain("invariant entry 0 has invalid fields: verdicts.conflict");
});

test("contract label changes reshape the expected GitHub labels", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  const labels = TRACER_ADOPTION_CONTRACT_DATA.labels.filter(({ actual }) => actual !== "wontfix");
  writeTracerAdoptionContract(repoRoot, {
    ...TRACER_ADOPTION_CONTRACT_DATA,
    labels,
  });
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps({
    [repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL, labels: labels.map(({ actual }) => actual) },
  }));

  expect(report.findings.some((item: any) => item.component === "contract:tracer-adoption-v1")).toBe(false);
  expect(report.findings.some((item: any) => item.component === `repo-labels:${repoRoot}`)).toBe(false);
});

test("repo workflow pointer comes from tracer-adoption contract", () => {
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
  writeTracerAdoptionContract(repoRoot, {
    ...TRACER_ADOPTION_CONTRACT_DATA,
    repo: { workflow_pointer: "setup-project-cockpit" },
  });
  writeText(join(repoRoot, "AGENTS.md"), `# AGENTS

Label authority: tracer-adoption:v1

The canonical-to-actual label mapping lives in tracer-adoption:v1.
`);
  writeText(join(repoRoot, "WORKFLOW.md"), `# Workflow

setup-project-cockpit
`);
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps({
    [repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL, labels: TRACER_ADOPTION_LABELS },
  }));

  expect(report.findings.some((item: any) => item.component === `repo-contract:${basename(repoRoot)}`)).toBe(false);
});


test("required aggregation uses conflict > fail > unverifiable > pass", () => {
  expect(aggregateTracerAdoptionInvariantVerdicts(["pass", "unverifiable", "fail", "conflict"], "required")).toBe("conflict");
  expect(aggregateTracerAdoptionInvariantVerdicts(["pass", "unverifiable", "fail"], "required")).toBe("fail");
  expect(aggregateTracerAdoptionInvariantVerdicts(["pass", "unverifiable"], "required")).toBe("unverifiable");
  expect(aggregateTracerAdoptionInvariantVerdicts(["pass", "pass"], "required")).toBe("pass");
});

test("advisory aggregation treats zero inputs as pass", () => {
  expect(aggregateTracerAdoptionInvariantVerdicts([], "advisory")).toBe("pass");
  expect(aggregateTracerAdoptionInvariantVerdicts(["pass", "unverifiable", "fail", "conflict"], "advisory")).toBe("conflict");
  expect(aggregateTracerAdoptionInvariantVerdicts(["pass", "unverifiable", "fail"], "advisory")).toBe("fail");
  expect(aggregateTracerAdoptionInvariantVerdicts(["pass", "unverifiable"], "advisory")).toBe("unverifiable");
});

test("required aggregation rejects empty input", () => {
  expect(() => aggregateTracerAdoptionInvariantVerdicts([], "required")).toThrow("required invariant aggregation needs at least one verdict");
});

test("state mapping is total and deterministic", () => {
  expect(evaluateTracerAdoptionState("pass", "pass")).toBe("adopted");
  expect(evaluateTracerAdoptionState("pass", "fail")).toBe("partial");
  expect(evaluateTracerAdoptionState("pass", "unverifiable")).toBe("blocked-or-unverifiable");
  expect(evaluateTracerAdoptionState("pass", "conflict")).toBe("blocked-or-unverifiable");
  expect(evaluateTracerAdoptionState("fail", "pass")).toBe("not-adopted");
  expect(evaluateTracerAdoptionState("fail", "conflict")).toBe("not-adopted");
  expect(evaluateTracerAdoptionState("unverifiable", "pass")).toBe("blocked-or-unverifiable");
  expect(evaluateTracerAdoptionState("conflict", "fail")).toBe("blocked-or-unverifiable");
});

test("tracer-adoption contract declares the canonical reducers and state mapping", () => {
  expect(TRACER_ADOPTION_CONTRACT_DATA.reducers).toEqual({
    required: { order: ["conflict", "fail", "unverifiable", "pass"], empty: "reject" },
    advisory: { order: ["conflict", "fail", "unverifiable", "pass"], empty: "pass" },
  });
  expect(TRACER_ADOPTION_CONTRACT_DATA.state_mapping).toEqual({
    required_pass: {
      advisory_pass: "adopted",
      advisory_fail: "partial",
      advisory_unverifiable_or_conflict: "blocked-or-unverifiable",
    },
    required_fail: "not-adopted",
    required_unverifiable_or_conflict: "blocked-or-unverifiable",
    skipped: "explicit-only",
  });
});

test("repo.workflow-pointer evidence names the concrete AGENTS.md and WORKFLOW.md checks", () => {
  expect(TRACER_ADOPTION_CONTRACT_DATA.repo).toMatchObject({
    workflow_pointer: "setup-matt-pocock-skills",
    evidence: {
      agents: "Label authority: tracer-adoption:v1",
      workflow: "setup-matt-pocock-skills",
    },
  });
  expect(TRACER_ADOPTION_CONTRACT_DATA.invariants.find((item: any) => item.id === "repo.workflow-pointer")?.evidence).toBe(
    "AGENTS.md contains Label authority: tracer-adoption:v1; WORKFLOW.md contains setup-matt-pocock-skills.",
  );
});

test("GitHub access expectation comes from tracer-adoption contract", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  writeTracerAdoptionContract(repoRoot, {
    ...TRACER_ADOPTION_CONTRACT_DATA,
    github: { identity: "GitHub repository slug from origin remote", access: "read-only label inventory" },
  });
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps({
    [repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL, ghFailure: "gh: permission denied\n" },
  }));

  const finding = report.findings.find((item: any) => item.component === `repo-label-access:${repoRoot}`);

  expect(finding).toMatchObject({
    severity: "error",
    expected: "read-only label inventory succeeds for ptstory/tracer-workflow",
  });
});

test("runtime skill directory symlink to the canonical checkout passes", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps());

  expect(report.findings.some((item: any) => item.component === "runtime-skill:next")).toBe(false);
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
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);

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
  makeCanonicalRuntimeSymlinks(clean.home, join(other.repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(clean.home, clean.repoRoot);

  const report = (buildDoctorReport as any)([clean.repoRoot], clean.home, makeDoctorDeps());
  const finding = report.findings.find((item: any) => item.component === "runtime-skill:next");

  expect(finding).toMatchObject({ severity: "error" });
  expect(finding?.observed).toContain(realpathSync(join(other.repoRoot, "skills/next")));
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
  makeCanonicalRuntimeSymlinks(home, join(canonicalRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, canonicalRoot);

  writePlist(
    join(worktreeRoot, "tooling/unbacked-work-monitor/com.tracer.unbacked-work-monitor.plist"),
    join(canonicalRoot, "tooling/unbacked-work-monitor/unbacked-work-monitor.ts"),
    {},
    join(canonicalRoot, ".bun/bin/bun"),
  );
  writePlist(
    join(worktreeRoot, "tooling/review-gate-poller/com.tracer.review-gate-poller.plist"),
    join(canonicalRoot, "tooling/review-gate-poller/poller.ts"),
    {
      RG_REPO: "ptstory/themarkergirl.com",
      RG_WORKDIR: canonicalRoot,
      PATH: `${join(canonicalRoot, ".bun/bin")}:/usr/bin:/bin`,
      HOME: home,
    },
    join(canonicalRoot, ".bun/bin/bun"),
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
  writeContracts(bad.repoRoot);
  rmSync(join(bad.repoRoot, "WORKFLOW.md"), { force: true });
  writeTooling(clean.repoRoot);
  writeTooling(bad.repoRoot);
  makeCanonicalRuntimeSymlinks(clean.home, join(clean.repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(clean.home, clean.repoRoot);

  const report = (buildDoctorReport as any)([clean.repoRoot, bad.repoRoot], clean.home, makeDoctorDeps({
    [clean.repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL },
    [bad.repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL },
  }));
  const repoFinding = report.findings.find((item: any) => item.component.startsWith("repo-contract:"));

  expect(repoFinding?.observed).toContain("fail: missing WORKFLOW.md");
  expect(report.findings.some((item: any) => item.component === "skill:next")).toBe(false);
});


test("missing AGENTS.md is a failure rather than unverifiable", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeContracts(repoRoot);
  rmSync(join(repoRoot, "AGENTS.md"), { force: true });
  writeTooling(repoRoot);
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps({
    [repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL },
  }));
  const repoFinding = report.findings.find((item: any) => item.component.startsWith("repo-contract:"));

  expect(repoFinding?.observed).toContain("fail: missing AGENTS.md");
});

test("repo contract pointer conflicts are reported through shared invariant semantics", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  writeText(join(repoRoot, "WORKFLOW.md"), `# Workflow\n\nsetup-project-cockpit\n`);
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps({
    [repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL, labels: TRACER_ADOPTION_LABELS },
  }));

  const finding = report.findings.find((item: any) => item.component === `repo-contract:${basename(repoRoot)}` && item.expected.startsWith("WORKFLOW.md"));

  expect(finding).toMatchObject({ severity: "error" });
  expect(finding?.observed).toContain("conflict: found setup-project-cockpit");
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
  makeCanonicalRuntimeSymlinks(repo.home, join(repo.repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(repo.home, repo.repoRoot);

  const stalePath = join(legacy.repoRoot, "tooling/unbacked-work-monitor/unbacked-work-monitor.ts");
  writeText(stalePath, "console.log('legacy');\n");
  writeInstalledLaunchdPlist(repo.home, "tooling/unbacked-work-monitor/com.tracer.unbacked-work-monitor.plist", stalePath, join(repo.repoRoot, ".bun/bin/bun"));

  const report = (buildDoctorReport as any)([repo.repoRoot], repo.home, makeDoctorDeps());
  const finding = report.findings.find((item: any) => item.component === "launchd:com.tracer.unbacked-work-monitor.plist");

  expect(finding).toMatchObject({ severity: "warning" });
  expect(report.summary.errors).toBe(0);
  expect(report.summary.warnings).toBeGreaterThan(0);
});

test("launchd jobs report a missing Bun launcher when the script path is correct", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);
  rmSync(join(repoRoot, ".bun/bin/bun"), { force: true });

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps());
  const finding = report.findings.find((item: any) => item.component === "launchd:com.tracer.unbacked-work-monitor.plist" && item.expected.includes("ProgramArguments[0]"));

  expect(finding).toMatchObject({ severity: "error" });
  expect(finding?.observed).toContain("configured launcher missing");
});

test("launchd jobs report a stale Bun launcher when the script path is correct", () => {
  const { repoRoot, home } = makeRepoRoot();
  const stale = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);
  writeExecutable(join(stale.repoRoot, ".bun/bin/bun"), "#!/usr/bin/env bash\nexit 0\n");

  writePlist(
    join(home, "Library/LaunchAgents/com.tracer.unbacked-work-monitor.plist"),
    join(repoRoot, "tooling/unbacked-work-monitor/unbacked-work-monitor.ts"),
    {},
    join(stale.repoRoot, ".bun/bin/bun"),
  );

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps());
  const finding = report.findings.find((item: any) => item.component === "launchd:com.tracer.unbacked-work-monitor.plist" && item.severity === "warning");

  expect(finding).toMatchObject({ severity: "warning" });
  expect(finding?.observed).toContain("stale configured launcher path");
});

test("stale launchd script paths still surface review-gate environment errors", () => {
  const repo = makeRepoRoot();
  const legacy = makeRepoRoot();
  writeCleanBaseline(repo.repoRoot);
  writeCleanBaseline(legacy.repoRoot);
  makeCanonicalRuntimeSymlinks(repo.home, join(repo.repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(repo.home, repo.repoRoot);

  const stalePath = join(legacy.repoRoot, "tooling/review-gate-poller/poller.ts");
  writeText(stalePath, "#!/usr/bin/env bun\n");
  writePlist(
    join(repo.home, "Library/LaunchAgents/com.tracer.review-gate-poller.plist"),
    stalePath,
    {
      RG_REPO: "ptstory/themarkergirl.com",
      PATH: `${join(repo.repoRoot, ".bun/bin")}:/usr/bin:/bin`,
      HOME: repo.home,
    },
    join(repo.repoRoot, ".bun/bin/bun"),
  );

  const report = (buildDoctorReport as any)([repo.repoRoot], repo.home, makeDoctorDeps());

  expect(report.findings.some((item: any) => item.component === "launchd:com.tracer.review-gate-poller.plist" && item.severity === "warning")).toBe(true);
  expect(report.findings.some((item: any) => item.component === "launchd:com.tracer.review-gate-poller.plist" && item.observed.includes("RG_WORKDIR"))).toBe(true);
  expect(report.summary.errors).toBeGreaterThan(0);
});

test("doctor findings use exactly one action each", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps());

  expect(report.findings.length).toBeGreaterThan(0);
  for (const finding of report.findings) {
    expect(finding.action).not.toMatch(/\b(and|or)\b|;/i);
  }
});

test("review-gate poller reports a missing RG_WORKDIR separately from its script path", () => {
  const { repoRoot, home } = makeRepoRoot();
  const opencodeBin = sandbox();
  writeCleanBaseline(repoRoot);
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);
  writeExecutable(join(opencodeBin, "opencode"), "#!/usr/bin/env bash\nexit 0\n");

  writePlist(
    join(home, "Library/LaunchAgents/com.tracer.review-gate-poller.plist"),
    join(repoRoot, "tooling/review-gate-poller/poller.ts"),
    {
      RG_REPO: "ptstory/themarkergirl.com",
      RG_WORKDIR: join(repoRoot, "missing-workdir"),
      PATH: `${opencodeBin}:/usr/bin:/bin`,
      HOME: home,
    },
    join(repoRoot, ".bun/bin/bun"),
  );

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps());
  const finding = report.findings.find((item: any) => item.component === "launchd:com.tracer.review-gate-poller.plist" && item.observed.includes("RG_WORKDIR"));

  expect(finding).toMatchObject({ severity: "error" });
  expect(finding?.expected).toContain("RG_WORKDIR");
  expect(finding?.observed).toContain("missing");
});

test("review-gate poller reports missing gh on PATH separately from its script path", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);
  const toolBin = join(home, ".local/test-bin");
  writeExecutable(join(toolBin, "opencode"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(toolBin, "git"), "#!/usr/bin/env bash\nexit 0\n");

  writePlist(
    join(home, "Library/LaunchAgents/com.tracer.review-gate-poller.plist"),
    join(repoRoot, "tooling/review-gate-poller/poller.ts"),
    {
      RG_REPO: "ptstory/themarkergirl.com",
      RG_WORKDIR: repoRoot,
      PATH: `${toolBin}:${join(repoRoot, ".bun/bin")}`,
      HOME: home,
    },
    join(repoRoot, ".bun/bin/bun"),
  );

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps());
  const finding = report.findings.find((item: any) => item.component === "launchd:com.tracer.review-gate-poller.plist" && item.expected.includes("gh"));

  expect(finding).toMatchObject({ severity: "error" });
  expect(finding?.expected).toContain("gh");
  expect(finding?.observed).toContain("PATH=");
});

test("filesystem inspection failures stay scoped and later checks still run", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);
  rmSync(join(repoRoot, "AGENTS.md"), { force: true });
  mkdirSync(join(repoRoot, "AGENTS.md"));

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps({
    [repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL, labels: ["needs-triage", "bug", "enhancement"] },
  }));

  const repoContractFinding = report.findings.find((item: any) => item.component === `repo-contract:${basename(repoRoot)}`);
  const labelFinding = report.findings.find((item: any) => item.component === `repo-labels:${repoRoot}`);

  expect(repoContractFinding?.observed).toContain("EISDIR");
  expect(labelFinding).toMatchObject({ severity: "error" });
});

test("CLI json mode emits structured output", () => {
  const { repoRoot, home } = makeRepoRoot();
  const canonicalRepoRoot = realpathSync(repoRoot);
  const doctorScript = fileURLToPath(new URL("./doctor.ts", import.meta.url));
  const stubBin = sandbox();
  writeSkills(
    canonicalRepoRoot,
    `---
name: next
description: >
  Pick the next unblocked ready-for-agent issue after merge.
---

# Next

Pick the next ready-for-agent issue.
`,
  );
  writeContracts(canonicalRepoRoot);
  writeTooling(canonicalRepoRoot);
  makeCanonicalRuntimeSymlinks(home, join(canonicalRepoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, canonicalRepoRoot);
  writeExecutable(join(stubBin, "git"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'git@github.com:ptstory/tracer-workflow.git'
`);
  writeExecutable(join(stubBin, "gh"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' '[{"name":"needs-triage"},{"name":"needs-info"},{"name":"ready-for-agent"},{"name":"ready-for-human"},{"name":"wontfix"},{"name":"bug"},{"name":"enhancement"}]'
`);

  const result = spawnSync("bun", [doctorScript, "--json", "--repo-root", canonicalRepoRoot, "--home", home], {
    cwd: canonicalRepoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ""}` },
  });

  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).summary).toEqual({ errors: 0, warnings: 0 });
  expect(result.stderr).toBe("");
});

test("CLI keeps tracer checks when one downstream repo root is supplied", () => {
  const { repoRoot, home } = makeRepoRoot();
  const downstream = makeRepoRoot();
  const canonicalRepoRoot = realpathSync(repoRoot);
  const canonicalDownstreamRoot = realpathSync(downstream.repoRoot);
  const doctorScript = fileURLToPath(new URL("./doctor.ts", import.meta.url));
  const stubBin = sandbox();
  writeCleanBaseline(canonicalRepoRoot);
  writeCleanBaseline(canonicalDownstreamRoot);
  makeCanonicalRuntimeSymlinks(home, join(canonicalRepoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, canonicalRepoRoot);
  rmSync(join(canonicalRepoRoot, "AGENTS.md"), { force: true });
  writeExecutable(join(stubBin, "git"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'git@github.com:ptstory/tracer-workflow.git'
`);
  writeExecutable(join(stubBin, "gh"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' '[{"name":"needs-triage"},{"name":"needs-info"},{"name":"ready-for-agent"},{"name":"ready-for-human"},{"name":"wontfix"},{"name":"bug"},{"name":"enhancement"}]'
`);

  const result = spawnSync("bun", [doctorScript, "--json", "--repo-root", canonicalDownstreamRoot, "--home", home], {
    cwd: canonicalRepoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ""}` },
  });

  expect(result.status).toBe(1);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.repoRoot).toBe(canonicalRepoRoot);
  expect(parsed.repoRoots).toContain(canonicalRepoRoot);
  expect(parsed.repoRoots).toContain(canonicalDownstreamRoot);
  expect(parsed.findings.some((item: any) => item.component === `repo-contract:${basename(canonicalRepoRoot)}`)).toBe(true);
  expect(parsed.findings.some((item: any) => item.component === `repo-contract:${basename(canonicalDownstreamRoot)}`)).toBe(false);
});

test("missing GitHub labels are reported for a repo with access", () => {
  const { repoRoot, home } = makeRepoRoot();
  writeCleanBaseline(repoRoot);
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);

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
  makeCanonicalRuntimeSymlinks(home, join(repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(home, repoRoot);

  const report = (buildDoctorReport as any)([repoRoot], home, makeDoctorDeps({
    [repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL, ghFailure: "gh: permission denied\n" },
  }));

  const finding = report.findings.find((item: any) => item.component === `repo-label-access:${repoRoot}`);

  expect(finding).toMatchObject({
    severity: "error",
    expected: "read-only label inventory succeeds for ptstory/tracer-workflow",
  });
  expect(finding?.observed).toContain("gh label list failed");
  expect(finding?.observed).toContain("permission denied");
});

test("one repo failing label access does not block another repo's label comparison", () => {
  const clean = makeRepoRoot();
  const blocked = makeRepoRoot();
  writeCleanBaseline(clean.repoRoot);
  writeCleanBaseline(blocked.repoRoot);
  makeCanonicalRuntimeSymlinks(clean.home, join(clean.repoRoot, "skills/next"));
  writeInstalledLaunchdTargets(clean.home, clean.repoRoot);

  const report = (buildDoctorReport as any)([clean.repoRoot, blocked.repoRoot], clean.home, makeDoctorDeps({
    [clean.repoRoot]: { remoteUrl: CANONICAL_REMOTE_URL },
    [blocked.repoRoot]: { remoteUrl: "git@github.com:ptstory/blocked-repo.git", ghFailure: "gh: unable to reach api\n" },
  }));

  expect(report.findings.some((item: any) => item.component === `repo-labels:${clean.repoRoot}`)).toBe(false);
  expect(report.findings.some((item: any) => item.component === `repo-label-access:${blocked.repoRoot}`)).toBe(true);
});
