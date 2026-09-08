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

type TracerAdoptionLabel = {
  canonical: string;
  actual: string;
};

type TracerAdoptionAdoptionState =
  | "adopted"
  | "partial"
  | "not-adopted"
  | "blocked-or-unverifiable"
  | "skipped";

type TracerAdoptionStateReducer = {
  order: TracerAdoptionInvariantVerdict[];
  empty: "reject" | "pass";
};

type TracerAdoptionStateMapping = {
  required_pass: {
    advisory_pass: TracerAdoptionAdoptionState;
    advisory_fail: TracerAdoptionAdoptionState;
    advisory_unverifiable_or_conflict: TracerAdoptionAdoptionState;
  };
  required_fail: TracerAdoptionAdoptionState;
  required_unverifiable_or_conflict: TracerAdoptionAdoptionState;
  skipped: "explicit-only";
};

type TracerAdoptionInvariantVerdicts = {
  pass: string;
  fail: string;
  unverifiable: string;
  conflict: string;
};

type TracerAdoptionInvariant = {
  id: string;
  description: string;
  status: "required" | "advisory";
  evidence: string;
  verdicts: TracerAdoptionInvariantVerdicts;
  remediation: {
    class: string;
    action: string;
  };
};

type TracerAdoptionContract = {
  schema_version: 1;
  contract: string;
  reducers: {
    required: TracerAdoptionStateReducer;
    advisory: TracerAdoptionStateReducer;
  };
  state_mapping: TracerAdoptionStateMapping;
  invariants: TracerAdoptionInvariant[];
  repo: {
    workflow_pointer: string;
    evidence: {
      agents: string;
      workflow: string;
    };
  };
  github: {
    identity: string;
    access: string;
  };
  labels: TracerAdoptionLabel[];
};

const EXPECTED_SKILL_NAME = "next";
const EXPECTED_SKILL_HEADING = "Next";
const TRACER_ADOPTION_CONTRACT_PATH = "tracer-adoption:v1";
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

type TracerAdoptionInvariantVerdict = "pass" | "fail" | "unverifiable" | "conflict";

function classifyTracerAdoptionInvariant(text: string | null, expected: string, conflictPattern: RegExp): { verdict: TracerAdoptionInvariantVerdict; observed: string } {
  if (text === null) {
    return { verdict: "unverifiable", observed: "missing file" };
  }

  if (text.includes(expected)) {
    return { verdict: "pass", observed: `found ${expected}` };
  }

  const conflict = text.match(conflictPattern)?.[0];
  if (conflict && conflict !== expected) {
    return { verdict: "conflict", observed: `found ${conflict}` };
  }

  return { verdict: "fail", observed: `missing ${expected}` };
}

function aggregateTracerAdoptionInvariantVerdicts(verdicts: TracerAdoptionInvariantVerdict[], className: "required" | "advisory"): TracerAdoptionInvariantVerdict {
  if (verdicts.length === 0) {
    if (className === "advisory") return "pass";
    throw new Error("required invariant aggregation needs at least one verdict");
  }

  if (verdicts.includes("conflict")) return "conflict";
  if (verdicts.includes("fail")) return "fail";
  if (verdicts.includes("unverifiable")) return "unverifiable";
  return "pass";
}

function evaluateTracerAdoptionState(requiredVerdict: TracerAdoptionInvariantVerdict, advisoryVerdict: TracerAdoptionInvariantVerdict): TracerAdoptionAdoptionState {
  if (requiredVerdict === "pass") {
    if (advisoryVerdict === "pass") return "adopted";
    if (advisoryVerdict === "fail") return "partial";
    return "blocked-or-unverifiable";
  }

  if (requiredVerdict === "fail") return "not-adopted";
  return "blocked-or-unverifiable";
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

function parseTracerAdoptionContract(text: string): { contract: TracerAdoptionContract | null; finding: DoctorFinding | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      contract: null,
      finding: finding(
        "contract:tracer-adoption-v1",
        `${TRACER_ADOPTION_CONTRACT_PATH} is schema-valid and declares the canonical invariants`,
        `could not parse ${TRACER_ADOPTION_CONTRACT_PATH}`,
        "error",
        "Restore the tracer-adoption contract artifact.",
      ),
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      contract: null,
      finding: finding(
        "contract:tracer-adoption-v1",
        `${TRACER_ADOPTION_CONTRACT_PATH} is schema-valid and declares the canonical invariants`,
        `expected a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
        "error",
        "Restore the tracer-adoption contract artifact.",
      ),
    };
  }

  const record = parsed as Partial<TracerAdoptionContract> & {
    reducers?: unknown;
    state_mapping?: unknown;
    invariants?: unknown;
    labels?: unknown;
    repo?: unknown;
    github?: unknown;
  };

  if (record.schema_version !== 1) {
    return {
      contract: null,
      finding: finding(
        "contract:tracer-adoption-v1",
        `${TRACER_ADOPTION_CONTRACT_PATH} schema_version 1 is required`,
        typeof record.schema_version === "number" ? `unsupported schema_version: ${record.schema_version}` : "missing or invalid fields: schema_version",
        "error",
        "Restore the tracer-adoption contract artifact.",
      ),
    };
  }

  const labels = Array.isArray(record.labels) ? record.labels : null;
  const reducers = record.reducers && typeof record.reducers === "object" ? (record.reducers as { required?: unknown; advisory?: unknown }) : null;
  const stateMapping = record.state_mapping && typeof record.state_mapping === "object"
    ? (record.state_mapping as {
        required_pass?: unknown;
        required_fail?: unknown;
        required_unverifiable_or_conflict?: unknown;
        skipped?: unknown;
      })
    : null;
  const invariants = Array.isArray(record.invariants) ? record.invariants : null;
  const repo = record.repo && typeof record.repo === "object" ? (record.repo as { workflow_pointer?: unknown; evidence?: unknown }) : null;
  const repoEvidence = repo && repo.evidence && typeof repo.evidence === "object" ? (repo.evidence as { agents?: unknown; workflow?: unknown }) : null;
  const github = record.github && typeof record.github === "object" ? (record.github as { identity?: unknown; access?: unknown }) : null;
  const missingFields = [
    record.contract !== TRACER_ADOPTION_CONTRACT_PATH ? "contract" : null,
    !labels ? "labels" : null,
    !reducers ? "reducers" : null,
    !stateMapping ? "state_mapping" : null,
    !invariants ? "invariants" : null,
    !repo ? "repo" : null,
    repo && typeof repo.workflow_pointer !== "string" ? "repo.workflow_pointer" : null,
    !repoEvidence ? "repo.evidence" : null,
    repoEvidence && typeof repoEvidence.agents !== "string" ? "repo.evidence.agents" : null,
    repoEvidence && typeof repoEvidence.workflow !== "string" ? "repo.evidence.workflow" : null,
    !github ? "github" : null,
    github && typeof github.identity !== "string" ? "github.identity" : null,
    github && typeof github.access !== "string" ? "github.access" : null,
  ].filter(Boolean);
  if (missingFields.length > 0) {
    return {
      contract: null,
      finding: finding(
        "contract:tracer-adoption-v1",
        `${TRACER_ADOPTION_CONTRACT_PATH} is schema-valid and declares the canonical invariants`,
        `missing or invalid fields: ${missingFields.join(", ")}`,
        "error",
        "Restore the tracer-adoption contract artifact.",
      ),
    };
  }

  const expectedReducerOrder: TracerAdoptionInvariantVerdict[] = ["conflict", "fail", "unverifiable", "pass"];
  const requiredReducer = reducers!.required && typeof reducers!.required === "object" ? (reducers!.required as Partial<TracerAdoptionStateReducer>) : null;
  const advisoryReducer = reducers!.advisory && typeof reducers!.advisory === "object" ? (reducers!.advisory as Partial<TracerAdoptionStateReducer>) : null;
  const reducerIssues = [
    !requiredReducer ? "reducers.required" : null,
    requiredReducer && (!Array.isArray(requiredReducer.order) || requiredReducer.order.length !== expectedReducerOrder.length || requiredReducer.order.some((item, index) => item !== expectedReducerOrder[index])) ? "reducers.required.order" : null,
    requiredReducer && requiredReducer.empty !== "reject" ? "reducers.required.empty" : null,
    !advisoryReducer ? "reducers.advisory" : null,
    advisoryReducer && (!Array.isArray(advisoryReducer.order) || advisoryReducer.order.length !== expectedReducerOrder.length || advisoryReducer.order.some((item, index) => item !== expectedReducerOrder[index])) ? "reducers.advisory.order" : null,
    advisoryReducer && advisoryReducer.empty !== "pass" ? "reducers.advisory.empty" : null,
  ].filter(Boolean);
  if (reducerIssues.length > 0) {
    return {
      contract: null,
      finding: finding(
        "contract:tracer-adoption-v1",
        `${TRACER_ADOPTION_CONTRACT_PATH} declares canonical reducers`,
        `invalid reducer fields: ${reducerIssues.join(", ")}`,
        "error",
        "Restore the tracer-adoption contract artifact.",
      ),
    };
  }

  const requiredPass = stateMapping!.required_pass && typeof stateMapping!.required_pass === "object"
    ? (stateMapping!.required_pass as {
        advisory_pass?: unknown;
        advisory_fail?: unknown;
        advisory_unverifiable_or_conflict?: unknown;
      })
    : null;
  const stateMappingIssues = [
    !requiredPass ? "state_mapping.required_pass" : null,
    requiredPass && requiredPass.advisory_pass !== "adopted" ? "state_mapping.required_pass.advisory_pass" : null,
    requiredPass && requiredPass.advisory_fail !== "partial" ? "state_mapping.required_pass.advisory_fail" : null,
    requiredPass && requiredPass.advisory_unverifiable_or_conflict !== "blocked-or-unverifiable" ? "state_mapping.required_pass.advisory_unverifiable_or_conflict" : null,
    stateMapping!.required_fail !== "not-adopted" ? "state_mapping.required_fail" : null,
    stateMapping!.required_unverifiable_or_conflict !== "blocked-or-unverifiable" ? "state_mapping.required_unverifiable_or_conflict" : null,
    stateMapping!.skipped !== "explicit-only" ? "state_mapping.skipped" : null,
  ].filter(Boolean);
  if (stateMappingIssues.length > 0) {
    return {
      contract: null,
      finding: finding(
        "contract:tracer-adoption-v1",
        `${TRACER_ADOPTION_CONTRACT_PATH} declares the canonical state mapping`,
        `invalid state mapping fields: ${stateMappingIssues.join(", ")}`,
        "error",
        "Restore the tracer-adoption contract artifact.",
      ),
    };
  }

  const normalizedLabels: TracerAdoptionLabel[] = [];
  for (const [index, item] of labels!.entries()) {
    if (!item || typeof item !== "object") {
      return {
        contract: null,
        finding: finding(
          "contract:tracer-adoption-v1",
          `${TRACER_ADOPTION_CONTRACT_PATH} is schema-valid and declares the canonical invariants`,
          `label entry ${index} is not an object`,
          "error",
          "Restore the tracer-adoption contract artifact.",
        ),
      };
    }

    const canonical = (item as { canonical?: unknown }).canonical;
    const actual = (item as { actual?: unknown }).actual;
    if (typeof canonical !== "string" || typeof actual !== "string" || canonical.trim() === "" || actual.trim() === "") {
      return {
        contract: null,
        finding: finding(
          "contract:tracer-adoption-v1",
          `${TRACER_ADOPTION_CONTRACT_PATH} is schema-valid and declares the canonical invariants`,
          `label entry ${index} must include canonical and actual strings`,
          "error",
          "Restore the tracer-adoption contract artifact.",
        ),
      };
    }

    normalizedLabels.push({ canonical: canonical.trim(), actual: actual.trim() });
  }

  const normalizedInvariants: TracerAdoptionInvariant[] = [];
  for (const [index, item] of invariants!.entries()) {
    if (!item || typeof item !== "object") {
      return {
        contract: null,
        finding: finding(
          "contract:tracer-adoption-v1",
          `${TRACER_ADOPTION_CONTRACT_PATH} declares stable invariants`,
          `invariant entry ${index} is not an object`,
          "error",
          "Restore the tracer-adoption contract artifact.",
        ),
      };
    }

    const invariant = item as Partial<TracerAdoptionInvariant>;
    const verdicts = invariant.verdicts && typeof invariant.verdicts === "object" ? (invariant.verdicts as Partial<TracerAdoptionInvariantVerdicts>) : null;
    const remediation = invariant.remediation && typeof invariant.remediation === "object" ? (invariant.remediation as { class?: unknown; action?: unknown }) : null;
    const requiredFields = [
      typeof invariant.id !== "string" || invariant.id.trim() === "" ? "id" : null,
      typeof invariant.description !== "string" || invariant.description.trim() === "" ? "description" : null,
      invariant.status !== "required" && invariant.status !== "advisory" ? "status" : null,
      typeof invariant.evidence !== "string" || invariant.evidence.trim() === "" ? "evidence" : null,
      !verdicts ? "verdicts" : null,
      verdicts && (typeof verdicts.pass !== "string" || verdicts.pass.trim() === "") ? "verdicts.pass" : null,
      verdicts && (typeof verdicts.fail !== "string" || verdicts.fail.trim() === "") ? "verdicts.fail" : null,
      verdicts && (typeof verdicts.unverifiable !== "string" || verdicts.unverifiable.trim() === "") ? "verdicts.unverifiable" : null,
      verdicts && (typeof verdicts.conflict !== "string" || verdicts.conflict.trim() === "") ? "verdicts.conflict" : null,
      !remediation ? "remediation" : null,
      remediation && typeof remediation.class !== "string" ? "remediation.class" : null,
      remediation && typeof remediation.action !== "string" ? "remediation.action" : null,
    ].filter(Boolean);

    if (requiredFields.length > 0) {
      return {
        contract: null,
        finding: finding(
          "contract:tracer-adoption-v1",
          `${TRACER_ADOPTION_CONTRACT_PATH} declares stable invariants`,
          `invariant entry ${index} has invalid fields: ${requiredFields.join(", ")}`,
          "error",
          "Restore the tracer-adoption contract artifact.",
        ),
      };
    }

    normalizedInvariants.push({
      id: invariant.id!.trim(),
      description: invariant.description!.trim(),
      status: invariant.status as "required" | "advisory",
      evidence: invariant.evidence!.trim(),
      verdicts: {
        pass: verdicts!.pass!.trim(),
        fail: verdicts!.fail!.trim(),
        unverifiable: verdicts!.unverifiable!.trim(),
        conflict: verdicts!.conflict!.trim(),
      },
      remediation: {
        class: String(remediation!.class).trim(),
        action: String(remediation!.action).trim(),
      },
    });
  }

  const expectedInvariantIds = ["contract.identity", "labels.registry", "repo.workflow-pointer", "github.access"];
  const actualInvariantIds = normalizedInvariants.map((item) => item.id);
  if (actualInvariantIds.length !== expectedInvariantIds.length || actualInvariantIds.some((item, index) => item !== expectedInvariantIds[index])) {
    return {
      contract: null,
      finding: finding(
        "contract:tracer-adoption-v1",
        `${TRACER_ADOPTION_CONTRACT_PATH} declares stable invariant ids`,
        `unexpected invariants: ${actualInvariantIds.join(", ")}`,
        "error",
        "Restore the tracer-adoption contract artifact.",
      ),
    };
  }

  return {
    contract: {
      schema_version: 1,
      contract: TRACER_ADOPTION_CONTRACT_PATH,
      reducers: {
        required: { order: expectedReducerOrder, empty: "reject" },
        advisory: { order: expectedReducerOrder, empty: "pass" },
      },
      state_mapping: {
        required_pass: {
          advisory_pass: "adopted",
          advisory_fail: "partial",
          advisory_unverifiable_or_conflict: "blocked-or-unverifiable",
        },
        required_fail: "not-adopted",
        required_unverifiable_or_conflict: "blocked-or-unverifiable",
        skipped: "explicit-only",
      },
      invariants: normalizedInvariants,
      repo: {
        workflow_pointer: String(repo!.workflow_pointer).trim(),
        evidence: {
          agents: String(repoEvidence!.agents).trim(),
          workflow: String(repoEvidence!.workflow).trim(),
        },
      },
      github: {
        identity: String(github!.identity).trim(),
        access: String(github!.access).trim(),
      },
      labels: normalizedLabels,
    },
    finding: null,
  };
}

function readTracerAdoptionContract(repoRoot: string): { contract: TracerAdoptionContract | null; finding: DoctorFinding | null } {
  const path = join(repoRoot, TRACER_ADOPTION_CONTRACT_PATH);
  if (!existsSync(path)) {
    return {
      contract: null,
      finding: finding(
        "contract:tracer-adoption-v1",
        `${TRACER_ADOPTION_CONTRACT_PATH} is schema-valid and declares the canonical invariants`,
        `${TRACER_ADOPTION_CONTRACT_PATH} is missing`,
        "error",
        "Restore the tracer-adoption contract artifact.",
      ),
    };
  }

  const read = readTextFile(path, "contract:tracer-adoption-v1", `${TRACER_ADOPTION_CONTRACT_PATH} is schema-valid and declares the canonical invariants`, "Restore the tracer-adoption contract artifact.");
  if (read.finding) return { contract: null, finding: read.finding };
  return parseTracerAdoptionContract(read.text ?? "");
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
    const contractRead = readTracerAdoptionContract(repoRoot);
    if (contractRead.finding) {
      return [contractRead.finding];
    }

    const expectedLabels = contractRead.contract?.labels.map((label) => label.actual) ?? [];
    const githubIdentity = contractRead.contract?.github.identity ?? "a GitHub repository slug from origin remote";
    const githubAccess = contractRead.contract?.github.access ?? "read-only label inventory";
    const repoSlug = resolveRepoSlug(repoRoot, deps);
    if (!repoSlug) {
      return [
        finding(
          `repo-label-slug:${repoRoot}`,
          `resolve ${githubIdentity} from ${repoRoot}`,
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
          `${githubAccess} succeeds for ${repoSlug}`,
          `gh label list failed: ${observed}`,
          "error",
          `Inspect ${githubIdentity} access for this repo.`,
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
          `${githubAccess} succeeds for ${repoSlug}`,
          `could not parse gh output: ${(error as Error).message}`,
          "error",
          `Inspect ${githubIdentity} access for this repo.`,
        ),
      ];
    }

    const observedLabels = Array.isArray(labels)
      ? labels
          .map((item) => (item && typeof item === "object" && "name" in item ? String((item as { name?: unknown }).name) : null))
          .filter((name): name is string => Boolean(name))
      : [];
    const missingLabels = expectedLabels.filter((label) => !observedLabels.includes(label));
    if (missingLabels.length === 0) return [];

    return [
      finding(
        `repo-labels:${repoRoot}`,
        `canonical GitHub labels: ${expectedLabels.join(", ")}`,
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

  const contractRead = readTracerAdoptionContract(repoRoot);
  if (contractRead.finding) {
    return [contractRead.finding];
  }

  const workflowPointer = contractRead.contract?.repo.workflow_pointer ?? "setup-matt-pocock-skills";

  const inspectPointerFile = (
    filePath: string,
    componentExpected: string,
    expectedPattern: RegExp,
    conflictPattern: RegExp,
    missingAction: string,
  ): DoctorFinding | null => {
    if (!existsSync(filePath)) {
      return finding(
        `repo-contract:${basename(repoRoot)}`,
        componentExpected,
        `fail: missing ${basename(filePath)}`,
        "error",
        missingAction,
      );
    }

    const read = readTextFile(filePath, `repo-contract:${basename(repoRoot)}`, componentExpected, missingAction);
    if (read.finding) {
      return read.finding;
    }

    const text = read.text ?? "";
    if (expectedPattern.test(text)) {
      return null;
    }

    const conflict = text.match(conflictPattern)?.[0];
    if (conflict) {
      return finding(
        `repo-contract:${basename(repoRoot)}`,
        componentExpected,
        `conflict: found ${conflict}`,
        "error",
        missingAction,
      );
    }

    return finding(
      `repo-contract:${basename(repoRoot)}`,
      componentExpected,
      `fail: missing ${componentExpected}`,
      "error",
      missingAction,
    );
  };

  const agentsFinding = inspectPointerFile(
    agentsPath,
    `AGENTS.md points to ${TRACER_ADOPTION_CONTRACT_PATH}`,
    /^Label authority:\s*tracer-adoption:v1$/m,
    /tracer-adoption:v\d+/g,
    "Restore the AGENTS.md label contract pointer.",
  );
  if (agentsFinding) findings.push(agentsFinding);

  const workflowFinding = inspectPointerFile(
    workflowPath,
    `WORKFLOW.md points to ${workflowPointer}`,
    new RegExp(`^${workflowPointer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
    /setup-[A-Za-z0-9-]+/g,
    "Restore the workflow pointer contract.",
  );
  if (workflowFinding) findings.push(workflowFinding);

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
  aggregateTracerAdoptionInvariantVerdicts,
  buildDoctorReport,
  checkLaunchdPath,
  checkNextSkill,
  checkRepoGitHubLabels,
  checkRepoContract,
  checkRuntimeSkillWiring,
  checkVerdictContract,
  evaluateTracerAdoptionState,
  parseArgs,
  parseGithubRepoSlug,
  parsePlistProgramArguments,
  parseSkillContract,
  renderDoctorText,
  resolveRepoSlug,
  runCli,
};
export type { CommandResult, DoctorDeps, DoctorFinding, DoctorReport, ParsedArgs, Severity };
