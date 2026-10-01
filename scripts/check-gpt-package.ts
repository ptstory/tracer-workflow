import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
      if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path) || path.startsWith("/")) continue;
      if (path.includes(" ")) continue;
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
    errors.push(`custom-gpt-instructions.md is ${length} characters; the Custom GPT limit is ${INSTRUCTIONS_LIMIT}`);
  }
  const paths = readmeSourcePaths(readme);
  if (paths.length === 0) {
    errors.push("README.md names no repository source paths in its table");
  }
  for (const path of paths) {
    if (!pathExists(path)) errors.push(`README.md names a missing file: ${path}`);
  }
  return errors;
}

function main(): void {
  const versions = readdirSync(packagesRoot)
    .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
    .sort(compareVersions);
  const latest = versions.at(-1);
  if (!latest) {
    console.error(`no versioned package under ${packagesRoot}`);
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
