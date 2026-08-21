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

function recognizePastedHandoff(text: string): boolean {
  const requiredSections = ["Goal", "Files", "Constraints", "Acceptance criteria", "Verification"];

  return /Issue\s+#\d+\s+handoff/i.test(text)
    && requiredSections.every((section) => new RegExp(`^${section}$`, "im").test(text));
}

function classifyAssistantResponse(response: string):
  | "create-or-reuse-worktree"
  | "execution-in-place"
  | "resume-existing-worktree"
  | "explicit-blocker"
  | "generic-approval-gate"
  | "unknown" {
  const text = normalize(response).toLowerCase();

  if (text.includes("approve this direction") && !text.includes("blocked:")) {
    return "generic-approval-gate";
  }

  if (text.includes("resume the existing issue/worktree") || text.includes("resume the same issue/worktree")) {
    return "resume-existing-worktree";
  }

  if (text.includes("blocked:")) {
    return "explicit-blocker";
  }

  if (text.includes("create or reuse") && text.includes("worktree")) {
    return "create-or-reuse-worktree";
  }

  if (text.includes("continue execution") || text.includes("implement the smallest safe slice") || text.includes("implement the slice")) {
    return "execution-in-place";
  }

  return "unknown";
}

function hasNamedBlocker(response: string): boolean {
  const text = normalize(response).toLowerCase();
  return text.includes("blocked:") && (text.includes("missing ") || text.includes("unresolved "));
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

  expectBehaviors(regressionCase.assistantResponse, regressionCase.mustMention);
  expectRejections(regressionCase.assistantResponse, regressionCase.mustNotMention);

  const outcome = classifyAssistantResponse(regressionCase.assistantResponse);
  expect(outcome).not.toBe("unknown");

  if (outcome === "unknown") {
    throw new Error(`Unclassified response for regression case ${regressionCase.id}`);
  }

  expect(regressionCase.expectedOutcomes).toContain(outcome);

  if (regressionCase.valid) {
    expect(outcome).not.toBe("generic-approval-gate");
  } else {
    expect(outcome).toBe("generic-approval-gate");
  }

  if (regressionCase.requireNamedBlocker) {
    expect(hasNamedBlocker(regressionCase.assistantResponse)).toBe(true);
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
