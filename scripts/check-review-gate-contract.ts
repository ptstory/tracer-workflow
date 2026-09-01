#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Issue = {
  file: string;
  field: string;
  message: string;
};

type VerdictState = "merge-candidate" | "needs-fix" | "needs-human" | "blocked";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(repoRoot, "skills/review-gate/references/verdict-contract.md");
const examplesPath = resolve(repoRoot, "skills/review-gate/references/verdict-examples.md");
const promptPath = resolve(repoRoot, "skills/review-gate/PROMPT.md");

function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function extractBulletFields(text: string, startMarker: string, endMarker: string): string[] {
  const start = text.indexOf(startMarker);
  if (start < 0) return [];

  const afterStart = start + startMarker.length;
  const end = text.indexOf(endMarker, afterStart);
  const section = text.slice(afterStart, end < 0 ? undefined : end);

  return Array.from(section.matchAll(/^\s*-\s+`([^`]+)`/gm), (match) => match[1].replace(/:$/, ""));
}

function extractMandatoryFieldsFromPrompt(text: string): string[] {
  const match = text.match(/The\s+([\s\S]*?)\s+lines are\s+mandatory\./);
  if (!match) return [];
  return Array.from(match[1].matchAll(/`([^`]+)`/g), (field) => field[1]);
}

function extractConditionalFieldsFromPrompt(text: string): string[] {
  if (/rebaseline/.test(text) && /omit otherwise/.test(text)) return ["rebaseline"];
  return [];
}

function parseCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const pattern = /```verdict\n([\s\S]*?)```/g;
  for (const match of text.matchAll(pattern)) {
    blocks.push(match[1].replace(/\n$/, ""));
  }
  return blocks;
}

function splitLines(block: string): string[] {
  return block.split("\n");
}

function isNonNegativeInteger(value: string): boolean {
  return /^(0|[1-9]\d*)$/.test(value);
}

function isRepoRelativePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("~") || trimmed.endsWith("/")) return false;
  const normalized = trimmed.replace(/\\/g, "/");
  if (normalized.includes("//")) return false;
  for (const part of normalized.split("/")) {
    if (!part || part === "." || part === "..") return false;
  }
  const resolved = posix.normalize(normalized);
  return resolved === normalized && !resolved.startsWith("../") && resolved !== ".." && !isAbsolute(resolved);
}

function report(issues: Issue[]): void {
  for (const issue of issues) {
    console.error(`${issue.file}: ${issue.field}: ${issue.message}`);
  }
}

function validateContractPrompt(contractFields: string[], contractConditional: string[], promptText: string): Issue[] {
  const issues: Issue[] = [];
  const mandatoryFields = extractMandatoryFieldsFromPrompt(promptText);
  const promptConditional = extractConditionalFieldsFromPrompt(promptText);

  if (contractFields.join(",") !== mandatoryFields.join(",")) {
    const missing = contractFields.filter((field) => !mandatoryFields.includes(field));
    const extra = mandatoryFields.filter((field) => !contractFields.includes(field));
    if (missing.length > 0) {
      for (const field of missing) {
        issues.push({
          file: "skills/review-gate/PROMPT.md",
          field,
          message: "missing mandatory field instruction",
        });
      }
    }
    if (extra.length > 0) {
      for (const field of extra) {
        issues.push({
          file: "skills/review-gate/PROMPT.md",
          field,
          message: "unexpected mandatory field instruction",
        });
      }
    }
  }

  if (contractConditional.join(",") !== promptConditional.join(",")) {
    const missing = contractConditional.filter((field) => !promptConditional.includes(field));
    const extra = promptConditional.filter((field) => !contractConditional.includes(field));
    if (missing.length > 0) {
      for (const field of missing) {
        issues.push({
          file: "skills/review-gate/PROMPT.md",
          field,
          message: "missing conditional field instruction",
        });
      }
    }
    if (extra.length > 0) {
      for (const field of extra) {
        issues.push({
          file: "skills/review-gate/PROMPT.md",
          field,
          message: "unexpected conditional field instruction",
        });
      }
    }
  }

  return issues;
}

function validateVerdictBlock(block: string, index: number, requiredFields: string[]): Issue[] {
  const issues: Issue[] = [];
  const file = "skills/review-gate/references/verdict-examples.md";
  const lines = splitLines(block);
  const marker = lines[0]?.trim();
  const verdictMatch = marker?.match(/^## review-gate:\s*(merge-candidate|needs-fix|needs-human|blocked)$/);

  if (!verdictMatch) {
    issues.push({
      file,
      field: `verdict block ${index + 1}`,
      message: "missing or malformed review-gate marker",
    });
    return issues;
  }

  const verdict = verdictMatch[1] as VerdictState;
  let cursor = 1;
  while (cursor < lines.length && lines[cursor].trim() === "") cursor += 1;

  const parsed: Record<string, string> = {};

  for (const field of requiredFields) {
    const line = lines[cursor];
    if (line === undefined) {
      issues.push({ file, field, message: "missing required field" });
      continue;
    }

    const match = line.match(new RegExp(`^${field}:\\s*(.*)$`));
    if (!match) {
      issues.push({ file, field, message: `expected ${field}: line` });
      continue;
    }

    parsed[field] = match[1].trim();
    cursor += 1;
  }

  while (lines[cursor]?.trim() === "") cursor += 1;

  const rebaselineLine = lines[cursor]?.match(/^rebaseline:\s*(.*)$/);
  if (rebaselineLine) {
    parsed.rebaseline = rebaselineLine[1].trim();
    cursor += 1;
  }

  const headSha = parsed["head-sha"];
  if (headSha !== undefined && !/^[0-9a-f]{40}$/.test(headSha)) {
    issues.push({ file, field: "head-sha", message: `expected full 40-character lowercase SHA, got ${JSON.stringify(headSha)}` });
  }

  const reviewRound = parsed["review-round"];
  if (reviewRound !== undefined && !isNonNegativeInteger(reviewRound)) {
    issues.push({ file, field: "review-round", message: `expected nonnegative integer, got ${JSON.stringify(reviewRound)}` });
  }

  const reviewedFiles = parsed["reviewed-files"];
  if (reviewedFiles !== undefined && !isNonNegativeInteger(reviewedFiles)) {
    issues.push({ file, field: "reviewed-files", message: `expected nonnegative integer, got ${JSON.stringify(reviewedFiles)}` });
  }

  const blockingSet = parsed["blocking-set"];
  if (blockingSet !== undefined) {
    if (verdict !== "needs-fix") {
      if (blockingSet !== "") {
        issues.push({
          file,
          field: "blocking-set",
          message: `expected empty blocking-set for ${verdict}, got ${JSON.stringify(blockingSet)}`,
        });
      }
    } else {
      const entries = blockingSet.split(",").map((entry) => entry.trim()).filter(Boolean);
      if (entries.length === 0) {
        issues.push({ file, field: "blocking-set", message: "expected at least one repo-relative path for needs-fix" });
      }
      for (const entry of entries) {
        if (!isRepoRelativePath(entry)) {
          issues.push({ file, field: "blocking-set", message: `invalid repo-relative path ${JSON.stringify(entry)}` });
        }
      }
    }
  }

  const rebaseline = parsed.rebaseline;
  if (rebaseline !== undefined) {
    if (rebaseline !== "yes") {
      issues.push({ file, field: "rebaseline", message: `expected yes when present, got ${JSON.stringify(rebaseline)}` });
    }
    if (reviewRound !== "0") {
      issues.push({ file, field: "rebaseline", message: `expected review-round 0 when present, got ${JSON.stringify(reviewRound ?? "missing")}` });
    }
  }

  if (cursor < lines.length) {
    const rest = lines.slice(cursor).join("\n").trim();
    if (!rest) {
      issues.push({ file, field: `verdict block ${index + 1}`, message: "missing content after required fields" });
    }
  }

  return issues;
}

function main(): void {
  const contractText = readText(contractPath);
  const examplesText = readText(examplesPath);
  const promptText = readText(promptPath);

  const requiredFields = extractBulletFields(
    contractText,
    "Required fields immediately below the marker:",
    "Conditional marker immediately below the required fields:",
  );
  const conditionalFields = extractBulletFields(
    contractText,
    "Conditional marker immediately below the required fields:",
    "## Comment-only, no ref mutation",
  );

  const issues: Issue[] = [
    ...validateContractPrompt(requiredFields, conditionalFields, promptText),
  ];

  const blocks = parseCodeBlocks(examplesText);
  if (blocks.length === 0) {
    issues.push({
      file: "skills/review-gate/references/verdict-examples.md",
      field: "verdict block",
      message: "no ```verdict fenced code blocks found",
    });
  }

  blocks.forEach((block, index) => {
    issues.push(...validateVerdictBlock(block, index, requiredFields));
  });

  if (issues.length > 0) {
    report(issues);
    process.exitCode = 1;
    return;
  }

  console.log(`review-gate contract ok: ${blocks.length} verdict examples, prompt schema aligned`);
}

main();
