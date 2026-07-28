import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function expectContainsAll(text: string, fragments: string[]): void {
  for (const fragment of fragments) {
    expect(text).toContain(fragment);
  }
}

describe("from-issue contract", () => {
  test("ready-for-agent input is framed as an execution stage", () => {
    const skill = read("skills/from-issue/SKILL.md");
    const workflow = read("WORKFLOW.md");
    const readme = read("README.md");

    expectContainsAll(skill, ["execution stage", "`ready-for-agent`", "smallest safe slice"]);
    expectContainsAll(workflow, ["from-issue` is the execution stage", "`ready-for-agent` issue"]);
    expectContainsAll(readme, ["`from-issue` is the execution stage", "`ready-for-agent` issue"]);
  });

  test("dirty checkout and worktree handling is explicit", () => {
    const skill = read("skills/from-issue/SKILL.md");
    const workflow = read("WORKFLOW.md");

    expectContainsAll(skill, ["dirty checkout/worktree state explicitly", "current-issue work", "unrelated drift"]);
    expectContainsAll(workflow, ["dirty checkout/worktree", "stops with a blocker handoff"]);
  });

  test("genuine blockers are the only handoff-only result", () => {
    const skill = read("skills/from-issue/SKILL.md");
    const workflow = read("WORKFLOW.md");
    const readme = read("README.md");

    expectContainsAll(skill, ["handoff-only result is allowed only for genuine blockers", "blocker handoff only"]);
    expectContainsAll(workflow, ["Handoff-only only for genuine blockers"]);
    expectContainsAll(readme, ["handoff-only result is allowed only for genuine blockers"]);
  });

  test("same issue and worktree resume instead of spawning a new implementation handoff", () => {
    const skill = read("skills/from-issue/SKILL.md");
    const workflow = read("WORKFLOW.md");
    const readme = read("README.md");

    expectContainsAll(skill, ["Resume the existing issue/worktree", "Do not emit another implementation handoff for the same issue"]);
    expectContainsAll(workflow, ["resumes the same issue/worktree", "rather than spawning a fresh implementation handoff"]);
    expectContainsAll(readme, ["must not emit a second implementation handoff for the same issue"]);
  });

  test("managed ignore blocks cover slim worktrees", () => {
    const gitignore = read(".gitignore");
    const ignore = read(".ignore");

    expect(gitignore.trim()).toBe(`
# BEGIN oh-my-opencode-slim worktrees
.slim/worktrees/
.slim/worktrees.json
# END oh-my-opencode-slim worktrees
`.trim());
    expect(ignore.trim()).toBe(`
# BEGIN oh-my-opencode-slim worktrees
!.slim/
!.slim/worktrees.json
!.slim/worktrees/
!.slim/worktrees/**
# END oh-my-opencode-slim worktrees
`.trim());
  });
});
