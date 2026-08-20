import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contractScenarios, docs, type ContractDoc } from "./from-issue-contract.fixtures";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function section(text: string, heading: string): string {
  const start = text.indexOf(`${heading}\n`);
  expect(start).toBeGreaterThanOrEqual(0);

  const rest = text.slice(start + heading.length + 1);
  const nextHeading = rest.search(/^##\s/m);

  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function expectFragments(text: string, fragments: string[]): void {
  const haystack = normalize(text);

  for (const fragment of fragments) {
    expect(haystack).toContain(normalize(fragment));
  }
}

function expectNoFragments(text: string, fragments: string[] = []): void {
  const haystack = normalize(text);

  for (const fragment of fragments) {
    expect(haystack).not.toContain(normalize(fragment));
  }
}

function expectManagedBlock(text: string, fragments: string[]): void {
  expectFragments(text, fragments);
  expectNoFragments(text, ["<<<<<<<", "=======", ">>>>>>>"]);
}

function docText(doc: ContractDoc): string {
  return read(docs[doc]);
}

describe("from-issue contract", () => {
  for (const scenario of contractScenarios) {
    test(scenario.name, () => {
      for (const check of scenario.checks) {
        const text = docText(check.doc);
        const target = check.section ? section(text, check.section) : text;

        expectFragments(target, check.fragments);
        expectNoFragments(target, check.forbidden);
      }
    });
  }

  test("managed ignore blocks cover slim worktrees", () => {
    const gitignore = read(".gitignore");
    const ignore = read(".ignore");

    expectManagedBlock(gitignore, [
      "# BEGIN oh-my-opencode-slim worktrees",
      ".slim/worktrees/",
      ".slim/worktrees.json",
      "# END oh-my-opencode-slim worktrees",
    ]);
    expectManagedBlock(ignore, [
      "# BEGIN oh-my-opencode-slim worktrees",
      "!.slim/",
      "!.slim/worktrees.json",
      "!.slim/worktrees/",
      "!.slim/worktrees/**",
      "# END oh-my-opencode-slim worktrees",
    ]);
  });
});
