import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = join(repoRoot, "actions/review-gate-plugin");

export const REQUIRED_LIVE_CONTRACT_PATHS = [
  "skills/review-gate/PROMPT.md",
  "skills/review-gate/references/verdict-contract.md",
  "skills/from-issue/references/pr-body-contract.md",
] as const;

export const REQUIRED_PACKAGE_PATHS = [
  "plugin.json",
  "skills/review-gate/SKILL.md",
  "skills/review-gate/references/acceptance-tests.md",
  "skills/review-gate/references/contract-snapshot-2026-10-01.md",
  "skills/review-gate/references/review-method.md",
] as const;

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

type Manifest = {
  name?: unknown;
  version?: unknown;
  $schema?: unknown;
  extensions?: unknown;
};

export function checkPluginPackage(
  versionDir: string,
  packageRoot: string,
  manifestText: string,
  skillText: string,
  pathExists: (path: string) => boolean,
): string[] {
  const errors: string[] = [];
  let manifest: Manifest;

  try {
    manifest = JSON.parse(manifestText) as Manifest;
  } catch {
    return ["plugin.json is not valid JSON"];
  }

  const expectedVersion = versionDir.replace(/^v/, "");
  if (manifest.name !== basename(packageRoot)) {
    errors.push(`plugin.json name must match package directory ${basename(packageRoot)}`);
  }
  if (manifest.version !== expectedVersion) {
    errors.push(`plugin.json version must match version directory ${expectedVersion}`);
  }
  if (manifest.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json") {
    errors.push("plugin.json must use the Agent Plugins 1.0 schema");
  }
  if (!manifest.extensions || typeof manifest.extensions !== "object") {
    errors.push("plugin.json must declare client-specific extensions");
  }

  for (const path of REQUIRED_PACKAGE_PATHS) {
    if (!pathExists(join(packageRoot, path))) {
      errors.push(`missing package file: ${path}`);
    }
  }

  for (const path of REQUIRED_LIVE_CONTRACT_PATHS) {
    if (!pathExists(join(repoRoot, path))) {
      errors.push(`missing live Tracer contract: ${path}`);
    }
    if (!skillText.includes(path)) {
      errors.push(`SKILL.md does not reference live Tracer contract: ${path}`);
    }
  }

  return errors;
}

function main(): void {
  const versions = readdirSync(packagesRoot)
    .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
    .sort(compareVersions);
  const latest = versions.at(-1);
  if (!latest) {
    console.error(`no versioned plugin package under ${packagesRoot}`);
    process.exit(2);
  }

  const packageRoot = join(packagesRoot, latest, "review-gate");
  const manifestPath = join(packageRoot, "plugin.json");
  const skillPath = join(packageRoot, "skills/review-gate/SKILL.md");

  if (!existsSync(manifestPath) || !existsSync(skillPath)) {
    console.error(`review-gate-plugin ${latest}: missing plugin.json or SKILL.md`);
    process.exit(1);
  }

  const errors = checkPluginPackage(
    latest,
    packageRoot,
    readFileSync(manifestPath, "utf8"),
    readFileSync(skillPath, "utf8"),
    existsSync,
  );

  if (errors.length) {
    for (const error of errors) console.error(`review-gate-plugin ${latest}: ${error}`);
    process.exit(1);
  }

  console.log(
    `review-gate-plugin ${latest}: package shape, version, manifest, references, and live-contract pointers valid`,
  );
}

if (import.meta.main) {
  main();
}
