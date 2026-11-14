import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatCheckDiagnostic } from "./check-diagnostic";

// Custom GPT Instructions field limit, counted in characters.
export const INSTRUCTIONS_LIMIT = 8000;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = join(repoRoot, "actions/review-gate-gpt");

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function countCharacters(text: string): number {
  return [...text].length;
}

// Repo-relative paths named in backticks inside README table rows.
export function readmeSourcePaths(readme: string): string[] {
  const paths: string[] = [];
  for (const line of readme.split("\n")) {
    if (!line.startsWith("|")) continue;
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const path = match[1];
      if (!path.includes("/") || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path) || path.startsWith("/")) continue;
      paths.push(path);
    }
  }
  return paths;
}

export function checkPackage(
  instructions: string,
  readme: string,
  pathExists: (path: string) => boolean,
): string[] {
  const errors: string[] = [];
  const length = countCharacters(instructions);
  if (length > INSTRUCTIONS_LIMIT) {
    errors.push(formatCheckDiagnostic(`custom-gpt-instructions.md is at most ${INSTRUCTIONS_LIMIT} characters`, `${length} characters`, `reduce the instruction text to ${INSTRUCTIONS_LIMIT} characters or fewer`));
  }
  const paths = readmeSourcePaths(readme);
  if (paths.length === 0) {
    errors.push(formatCheckDiagnostic("at least one repository source path in the README table", "none", "add repository source paths to README.md or remove the invalid check input"));
  }
  for (const path of paths) {
    if (!pathExists(path)) errors.push(formatCheckDiagnostic(`an existing repository file named in README.md`, `missing path ${path}`, `correct or remove the stale README.md path`));
  }
  return errors;
}

function main(): void {
  const versions = readdirSync(packagesRoot)
    .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
    .sort(compareVersions);
  const latest = versions.at(-1);
  if (!latest) {
    console.error(formatCheckDiagnostic(`a versioned package under ${packagesRoot}`, "none found", "add or restore a versioned package"));
    process.exit(2);
  }
  const dir = join(packagesRoot, latest);
  const errors = checkPackage(
    readFileSync(join(dir, "custom-gpt-instructions.md"), "utf8"),
    readFileSync(join(dir, "README.md"), "utf8"),
    (path) => existsSync(join(repoRoot, path)),
  );
  if (errors.length) {
    for (const error of errors) console.error(`gpt-package ${latest}: ${error}`);
    process.exit(1);
  }
  console.log(`gpt-package ${latest}: instructions within ${INSTRUCTIONS_LIMIT} characters; all README source paths exist`);
}

if (import.meta.main) {
  main();
}
