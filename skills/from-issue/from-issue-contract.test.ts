import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { completeHandoff, incompleteHandoff, regressionCases, type RegressionCase } from "./from-issue-contract.fixtures";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

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

function normalizeHeading(heading: string): string {
  return heading.trim().toLowerCase();
}

function readSection(text: string, heading: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => normalizeHeading(line) === `## ${normalizeHeading(heading)}`);

  if (start === -1) {
    throw new Error(`Missing ## ${heading} section in SKILL.md`);
  }

  let end = lines.length;

  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) {
      end = index;
      break;
    }
  }

  return lines.slice(start + 1, end).join("\n");
}

function recognizePastedHandoff(text: string): boolean {
  const requiredSections = ["Goal", "Files", "Constraints", "Acceptance criteria", "Verification"];

  return /Issue\s+#\d+\s+handoff/i.test(text)
    && requiredSections.every((section) => new RegExp(`^${section}$`, "im").test(text));
}

function assertRegressionCase(regressionCase: RegressionCase): void {
  if (
    regressionCase.input.pastedArtifact !== undefined
    && regressionCase.input.shouldRecognizePastedArtifact !== undefined
  ) {
    expect(recognizePastedHandoff(regressionCase.input.pastedArtifact)).toBe(
      regressionCase.input.shouldRecognizePastedArtifact,
    );
  }

  const skillDoc = read("skills/from-issue/SKILL.md");

  for (const assertion of regressionCase.skillMatches) {
    const section = normalize(readSection(skillDoc, assertion.heading)).toLowerCase();

    for (const fragment of assertion.mustContain) {
      expect(section).toContain(normalize(fragment).toLowerCase());
    }
  }
}

describe("from-issue contract", () => {
  test("handoff recognition accepts the required pasted shape and rejects incomplete copies", () => {
    expect(recognizePastedHandoff(completeHandoff)).toBe(true);
    expect(recognizePastedHandoff(incompleteHandoff)).toBe(false);
  });

  test("covers all nine issue #20 regression cases", () => {
    expect(regressionCases).toHaveLength(9);
  });

  test("regression case 1 asserts the execution transition into the documented Steps", () => {
    const regressionCase = regressionCases[0];
    const steps = regressionCase.skillMatches.find(({ heading }) => heading === "Steps");

    expect(steps).toBeDefined();
    expect(steps?.mustContain).toContain("validate the input artifact if it was pasted, then resume the same issue/worktree when present");
    expect(steps?.mustContain).toContain("implement the smallest safe slice");
  });

  for (const regressionCase of regressionCases) {
    test(`${regressionCase.id}. ${regressionCase.name}`, () => {
      expect(regressionCase.input.summary).toBeTruthy();
      assertRegressionCase(regressionCase);
    });
  }

  test("managed ignore blocks cover slim worktrees", () => {
    const gitignore = read(".gitignore");
    const ignore = read(".ignore");

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
