#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVisualProofComment } from "./visual-proof-contract";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8").replace(/\r\n/g, "\n");
}

function requireSnippets(file: string, snippets: string[]): string[] {
  const text = read(file).replace(/\s+/g, " ");
  return snippets
    .filter((snippet) => !text.includes(snippet.replace(/\s+/g, " ")))
    .map((snippet) => `${file}: missing contract text ${JSON.stringify(snippet)}`);
}

function extractProofExamples(text: string): string[] {
  return Array.from(text.matchAll(/```visual-proof\n([\s\S]*?)```/g), (match) => match[1].replace(/\n$/, ""));
}

function main(): void {
  const issues: string[] = [];

  issues.push(...requireSnippets("skills/visual-proof/SKILL.md", [
    "after the final implementation push",
    "`review-gate` independently classifies the current-head evidence as `PROVIDED`, `N/A`, or `MISSING`",
    "gh pr comment <PR> --body-file <file> --attach",
    "Any later push makes this proof stale",
    "Do not commit transient screenshots/videos to the repository",
  ]));

  issues.push(...requireSnippets("skills/visual-proof/references/comment-contract.md", [
    "current-head `provided` + sufficient + scope-faithful -> `PROVIDED`",
    "only older-head proof for otherwise renderable visual work -> `MISSING`",
    "no reasonable render path without out-of-scope integration -> `N/A`",
    "renderable visual work + producer `n/a` -> `MISSING`",
    "renderable visual work + no current proof -> `MISSING`",
    "backend/CLI/internal-only change -> `N/A`",
    "scope overclaim",
    "`MISSING` by itself prevents `merge-candidate` and yields `blocked`",
  ]));

  issues.push(...requireSnippets("skills/from-issue/SKILL.md", [
    "Run `visual-proof` for the final PR head before handoff when the slice is visually inspectable",
  ]));

  issues.push(...requireSnippets("skills/review-gate/PROMPT.md", [
    "classify visual proof for the current head as `PROVIDED`, `N/A`, or `MISSING`",
    "Do not accept a producer `n/a` as authority",
    "### Visual proof",
    "A stale proof comment never counts for the current head",
  ]));

  issues.push(...requireSnippets("skills/review-gate/references/verdict-contract.md", [
    "## Visual proof evidence",
    "`PROVIDED`, `N/A`, or `MISSING`",
    "A producer `n/a` is advisory, never authority",
    "`MISSING` alone yields `blocked`",
  ]));

  const examples = extractProofExamples(read("skills/visual-proof/references/comment-examples.md"));
  if (examples.length < 4) {
    issues.push(`skills/visual-proof/references/comment-examples.md: expected at least 4 visual-proof examples, got ${examples.length}`);
  }
  for (const [index, example] of examples.entries()) {
    if (!parseVisualProofComment(example)) {
      issues.push(`skills/visual-proof/references/comment-examples.md: example ${index + 1} does not parse`);
    }
  }

  if (issues.length > 0) {
    for (const issue of issues) console.error(issue);
    process.exitCode = 1;
    return;
  }

  console.log(`visual-proof contract ok: ${examples.length} producer examples, producer/reviewer docs aligned`);
}

main();
