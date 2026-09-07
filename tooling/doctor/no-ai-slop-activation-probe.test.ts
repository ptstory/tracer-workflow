import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runNoAiSlopActivationProbe } from "./no-ai-slop-activation-probe";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "tracer-doctor-probe-"));
}

test("activation probe discovers repo-owned no-ai-slop from isolated HOME", () => {
  const repoRoot = "/Users/perrystory/Code/.worktrees/tracer-workflow-issue-106-runtime-activation-evidence";
  const stubBin = sandbox();
  mkdirSync(stubBin, { recursive: true });
  writeFileSync(
    join(stubBin, "opencode"),
    `#!/usr/bin/env bun
const home = process.env.HOME ?? "";
const raw = await Bun.file("${repoRoot}/skills/no-ai-slop/SKILL.md").text();
const skill = raw.replace(/^---\\n[\\s\\S]*?\\n---\\n/, "");
console.log(JSON.stringify([{ name: "no-ai-slop", location: home + "/.agents/skills/no-ai-slop/SKILL.md", content: skill }]));
`,
  );
  chmodSync(join(stubBin, "opencode"), 0o755);

  const result = runNoAiSlopActivationProbe({ repoRoot, opencodeBinary: join(stubBin, "opencode") });

  expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
  expect(result.transcript.command).toEqual(["opencode", "debug", "skill", "--pure"]);
  expect(result.transcript.discovered?.name).toBe("no-ai-slop");
  expect(result.transcript.discovered?.location).toBe(join(result.transcript.home, ".agents/skills/no-ai-slop/SKILL.md"));
  expect(result.transcript.discovered?.contentMatches).toBe(true);
  rmSync(stubBin, { recursive: true, force: true });
});
