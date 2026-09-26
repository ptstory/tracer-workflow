import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function expectBehaviors(text: string, fragments: string[] = []): void {
  const haystack = normalize(text).toLowerCase();

  for (const fragment of fragments) {
    expect(haystack).toContain(normalize(fragment).toLowerCase());
  }
}

function expectRejections(text: string, fragments: string[] = []): void {
  const haystack = normalize(text).toLowerCase();

  for (const fragment of fragments) {
    expect(haystack).not.toContain(normalize(fragment).toLowerCase());
  }
}

describe("repository ignore configuration", () => {
  test("managed ignore blocks cover slim worktrees", () => {
    const gitignore = readFileSync(join(repoRoot, ".gitignore"), "utf8");
    const ignore = readFileSync(join(repoRoot, ".ignore"), "utf8");

    expectBehaviors(gitignore, [
      "# BEGIN oh-my-opencode-slim worktrees",
      ".slim/worktrees/",
      ".slim/worktrees.json",
      "# END oh-my-opencode-slim worktrees",
    ]);
    expectRejections(gitignore, ["<<<<<<<", "=======", ">>>>>>>"]);
    expectBehaviors(ignore, [
      "# BEGIN oh-my-opencode-slim worktrees",
      "!.slim/",
      "!.slim/worktrees.json",
      "!.slim/worktrees/",
      "!.slim/worktrees/**",
      "# END oh-my-opencode-slim worktrees",
    ]);
    expectRejections(ignore, ["<<<<<<<", "=======", ">>>>>>>"]);
  });
});
