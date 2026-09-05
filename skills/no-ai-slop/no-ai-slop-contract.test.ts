import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { syntheticSlopSample, voicefulAllowedSample } from "./no-ai-slop-contract.fixtures";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const EXPECTED_HUMANIZER_PATTERNS = [
  "Inflated importance and legacy",
  "Name-dropping to prove importance",
  "Shallow -ing analysis",
  "Sales language",
  "Vague sources",
  "Formulaic challenges and outlook",
  "Overused AI words",
  "Avoiding is and are",
  "Not X but Y and clipped endings",
  "Forced groups of three",
  "Changing names and repeated openings",
  "False from X to Y ranges",
  "Passive voice and missing subjects",
  "Em and en dashes",
  "Too much bold text",
  "Lists with bold mini-headings",
  "Title case in headings",
  "Emojis",
  "Curly quotation marks",
  "Chatbot text left in the answer",
  "Knowledge-limit disclaimers and guesses",
  "Overly agreeable tone",
  "Filler phrases",
  "Too many qualifiers",
  "Generic positive endings",
  "Too many hyphenated word pairs",
  "Pretending to reveal a deeper truth",
  "Announcing the next point",
  "A heading repeated in the first sentence",
  "Writing about the previous version",
  "Forced punchlines and dramatic fragments",
  "Formulaic sayings",
  "Fake-candid openings",
  "Answering objections no one raised",
  "Rejecting fake alternatives",
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function extractHumanizerPatternTitles(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.match(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => match[2].trim());
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

  expect(skill).toContain("This repo owns a downstream copy of `petergyang/no-ai-slop@000650b156983f5159695b441477f4e63b25dc85`.");
  expect(skill).toContain("The notes below are additive to the pinned upstream behavior, not a silent replacement for it.");
  expect(skill).toContain("Humanizer is findings-only supplemental audit");
  expect(skill).toContain("It is not a second rewrite pass, reorder stage, or delivery route.");
  expect(skill).toContain("These are not bans: em dashes, emojis, title case, bold-label lists, passive voice, groups of three, repeated sentence openings, and rhetorical fragments.");
  expect(skill).toContain("minimum effective edit");
  expect(skill).toContain("delve, foster, leverage, utilize, facilitate, empower, streamline, robust");
  expect(reference).toContain("Humanizer v2.11.2");
  expect(reference).toContain("e2e92e7b4b8229253ed5c8e81dc65463fdeddda5");
  expect(reference).toContain("blader/humanizer");
});

test("humanizer pattern reference keeps the pinned provenance and full 35-pattern taxonomy", () => {
  const reference = read("skills/no-ai-slop/reference/humanizer-patterns.md");
  const titles = extractHumanizerPatternTitles(reference);

  expect(reference).toContain("Derived from `blader/humanizer` `SKILL.md` and `README.md` at commit");
  expect(reference).toContain("`e2e92e7b4b8229253ed5c8e81dc65463fdeddda5` (Humanizer v2.11.2).");
  expect(reference).toContain("Use this file only as a supplemental findings checklist for");
  expect(reference).toContain("It is not a ban list.");
  expect(reference).toContain("Non-bans in `skills/no-ai-slop/SKILL.md`: em dashes, emojis, title case,");
  expect(reference).toContain("bold-label lists, passive voice, groups of three, repeated sentence openings,");
  expect(reference).toContain("and rhetorical fragments.");
  expect(titles).toEqual([...EXPECTED_HUMANIZER_PATTERNS]);
  expect(titles).toHaveLength(35);
});
