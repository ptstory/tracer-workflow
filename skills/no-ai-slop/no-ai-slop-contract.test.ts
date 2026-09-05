import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { syntheticSlopSample, voicefulAllowedSample } from "./no-ai-slop-contract.fixtures";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function findSupplementalHumanizerFindings(text: string): string[] {
  const findings: string[] = [];

  if (/here's the thing|let's dive in|what nobody tells you/i.test(text)) findings.push("throat-clearing opener");
  if (/transformative|cutting-edge|breathtaking|nested within|stands as a testament/i.test(text)) findings.push("sales language");
  if (/the future isn't coming|the future is already here|the future looks bright/i.test(text)) findings.push("generic positive ending");
  if (/it\s*'s not [^.]+it\s*'s|not just [^.]+but/i.test(text)) findings.push("binary contrast");
  if (/actually|additionally|crucial|leverages|showcasing/i.test(text)) findings.push("overused AI words");

  return findings;
}

test("preserves a deliberately human voiceful sample without flagging non-bans", () => {
  expect(voicefulAllowedSample).toContain("—");
  expect(voicefulAllowedSample).toContain("She came. She saw. She shipped it.");
  expect(voicefulAllowedSample).toContain("- **Status:** The point stays the same.");
  expect(findSupplementalHumanizerFindings(voicefulAllowedSample)).toEqual([]);
});

test("synthetic slop sample triggers supplemental Humanizer findings", () => {
  const findings = findSupplementalHumanizerFindings(syntheticSlopSample);

  expect(findings).toContain("throat-clearing opener");
  expect(findings).toContain("sales language");
  expect(findings).toContain("generic positive ending");
  expect(findings.length).toBeGreaterThanOrEqual(3);
});

test("skill copy keeps the upstream minimum-edit and supplemental-audit guarantees", () => {
  const skill = read("skills/no-ai-slop/SKILL.md");
  const reference = read("skills/no-ai-slop/reference/humanizer-patterns.md");

  expect(skill).toContain("minimum effective edit");
  expect(skill).toContain("Humanizer is findings-only supplemental audit");
  expect(skill).toContain("never as an autonomous rewrite or reorder pass");
  expect(reference).toContain("Humanizer v2.11.2");
  expect(reference).toContain("e2e92e7b4b8229253ed5c8e81dc65463fdeddda5");
  expect(reference).toContain("blader/humanizer");
});
