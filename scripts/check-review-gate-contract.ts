#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatCheckDiagnostic } from "./check-diagnostic";

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

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function validateTextSnippets(
  file: string,
  text: string,
  snippets: Array<{ field: string; snippet: string; message: string }>,
): Issue[] {
  const issues: Issue[] = [];
  const normalizedText = normalizeWhitespace(text);

  for (const { field, snippet, message } of snippets) {
    if (!normalizedText.includes(normalizeWhitespace(snippet))) {
      issues.push({ file, field, message });
    }
  }

  return issues;
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
    console.error(`${issue.file}: ${formatCheckDiagnostic(`valid ${issue.field}`, issue.message, "correct the contract source and rerun the check")}`);
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
    if (verdict !== "needs-fix" && verdict !== "blocked") {
      if (blockingSet !== "") {
        issues.push({
          file,
          field: "blocking-set",
          message: `expected empty blocking-set for ${verdict} without fix-now findings, got ${JSON.stringify(blockingSet)}`,
        });
      }
    } else {
      const entries = blockingSet.split(",").map((entry) => entry.trim()).filter(Boolean);
      if (entries.length === 0 && verdict === "needs-fix") {
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

function validateReadinessExamples(blocks: string[], contractText: string, promptText: string): Issue[] {
  const issues: Issue[] = [];
  const file = "skills/review-gate/references/verdict-examples.md";
  const mergeCandidateBlocks = blocks.filter((block) => block.startsWith("## review-gate: merge-candidate"));

  if (!mergeCandidateBlocks.some((block) => {
    const normalizedBlock = normalizeWhitespace(block);
    return normalizedBlock.includes("all applicable required checks are green on the current head") && normalizedBlock.includes("at least one applicable required check exercises the changed paths");
  })) {
    issues.push({
      file,
      field: "merge-candidate (configured required checks)",
      message: "missing configured required-check readiness path",
    });
  }

  if (!mergeCandidateBlocks.some((block) => {
    const normalizedBlock = normalizeWhitespace(block);
    return normalizedBlock.includes("no required checks are configured on the target branch") && normalizedBlock.includes("at least one green CI/check run on the current head exercises the changed paths");
  })) {
    issues.push({
      file,
      field: "merge-candidate (no required checks configured)",
      message: "missing no-required-check readiness path",
    });
  }

  if (!mergeCandidateBlocks.some((block) => normalizeWhitespace(block).includes("readiness evidence path: available"))) {
    issues.push({ file, field: "readiness evidence path", message: "missing available evidence-path example" });
  }

  if (!mergeCandidateBlocks.some((block) => normalizeWhitespace(block).includes("readiness evidence path: plan-unavailable"))) {
    issues.push({ file, field: "readiness evidence path", message: "missing plan-unavailable evidence-path example" });
  }

  const normalizedContract = normalizeWhitespace(contractText);
  if (!normalizedContract.includes("Record the readiness evidence path in the Review Record as `available`, `plan-unavailable`, or `indeterminate`.")) {
    issues.push({ file: "skills/review-gate/references/verdict-contract.md", field: "readiness evidence path", message: "missing indeterminate evidence-path rule" });
  }
  const docsOnlyAllowlistLines = contractText.split("\n").filter((line) => line.startsWith("- Docs-only allowlist:"));
  if (docsOnlyAllowlistLines.length !== 1) {
    issues.push({ file: "skills/review-gate/references/verdict-contract.md", field: "docs-only readiness", message: "expected exactly one canonical docs-only allowlist" });
  } else {
    const listText = docsOnlyAllowlistLines[0].slice("- Docs-only allowlist:".length).trim();
    const entries = listText.endsWith(".") ? listText.slice(0, -1).replace(/,\s+and\s+/, ", ").split(/,\s*/) : [];
    const paths: string[] = [];
    for (const entry of entries) {
      if (!/^`[^`]+`$/.test(entry)) {
        issues.push({ file: "skills/review-gate/references/verdict-contract.md", field: "docs-only readiness", message: `invalid canonical allowlist entry ${JSON.stringify(entry)}` });
        continue;
      }
      const path = entry.slice(1, -1);
      if (!isRepoRelativePath(path)) {
        issues.push({ file: "skills/review-gate/references/verdict-contract.md", field: "docs-only readiness", message: `invalid canonical allowlist path ${JSON.stringify(path)}` });
      }
      paths.push(path);
    }
    if (paths.length === 0) {
      issues.push({ file: "skills/review-gate/references/verdict-contract.md", field: "docs-only readiness", message: "canonical docs-only allowlist must contain at least one path" });
    }
    if (new Set(paths).size !== paths.length) {
      issues.push({ file: "skills/review-gate/references/verdict-contract.md", field: "docs-only readiness", message: "canonical docs-only allowlist must not contain duplicate paths" });
    }
  }
  const docsOnlyContractSnippets = [
    "`RADAR.md` is excluded because its append-only contract is checked separately.",
    "`CONTEXT.md`, `WORKFLOW.md`, `AGENTS.md`, `.agents/repo-context.md` (delegated operational and safety policy), `skills/**`, `actions/**`, `prompts/**`, workflow and Review Gate contract files, and all other paths are not allowlisted.",
    "Any non-allowlisted path, including a mixed PR, uses the ordinary path-coverage rules below.",
    "The `pr-body` check must pass even when it is not a branch-required check.",
  ];
  for (const snippet of docsOnlyContractSnippets) {
    if (!normalizedContract.includes(normalizeWhitespace(snippet))) {
      issues.push({ file: "skills/review-gate/references/verdict-contract.md", field: "docs-only readiness", message: `missing canonical rule: ${snippet}` });
    }
  }
  const docsOnlyExample = mergeCandidateBlocks.some((block) => {
    const normalizedBlock = normalizeWhitespace(block);
    return normalizedBlock.includes("every changed path matches the canonical docs-only allowlist")
      && normalizedBlock.includes("`pr-body` check is successful at the current head")
      && normalizedBlock.includes("clean Review Gate content review is bound to the same head");
  });
  if (!docsOnlyExample) {
    issues.push({ file, field: "merge-candidate (docs-only allowlist)", message: "missing docs-only readiness example" });
  }
  if (!normalizeWhitespace(promptText).includes("docs-only readiness exception")) {
    issues.push({ file: "skills/review-gate/PROMPT.md", field: "docs-only readiness", message: "missing canonical docs-only readiness reference" });
  }

  if (!normalizedContract.includes("`getBranch protected: false` is sufficient evidence that no classic required checks exist")) {
    issues.push({ file: "skills/review-gate/references/verdict-contract.md", field: "classic protection", message: "missing protected:false readiness rule" });
  }
  if (!normalizedContract.includes("when the calling surface rejects it before reaching GitHub (including HTTP 400/unsupported endpoint), fall through to `rulesets`")) {
    issues.push({ file: "skills/review-gate/references/verdict-contract.md", field: "rulesets fallback", message: "missing rulesets fall-through rule" });
  }

  if (!blocks.some((block) => normalizeWhitespace(block).includes("only older-head results exist; no current-head evidence counts"))) {
    issues.push({
      file,
      field: "blocked (stale head)",
      message: "missing current-head versus older-head evidence note",
    });
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
    ...validateTextSnippets("skills/review-gate/references/verdict-contract.md", contractText, [
      {
        field: "readiness",
        snippet: "target branch's required status-check configuration",
        message: "missing canonical readiness configuration language",
      },
      {
        field: "readiness",
        snippet: "Configured path: all applicable required checks are green at the current head",
        message: "missing configured-path current-head readiness rule",
      },
      {
        field: "readiness",
        snippet: "No-required-check path: at least one green CI/check run on the current head",
        message: "missing no-required-check current-head readiness rule",
      },
      {
        field: "readiness",
        snippet: "Older-head results never count.",
        message: "missing older-head staleness rule",
      },
      {
        field: "readiness",
        snippet: "Branch protection is not required.",
        message: "missing branch-protection clarification",
      },
      {
        field: "readiness",
        snippet: "Merge remains HITL by default.",
        message: "missing explicit merge-authorization clarification",
      },
    ]),
    ...validateTextSnippets("skills/review-gate/PROMPT.md", promptText, [
      {
        field: "readiness",
        snippet: "target branch's required status-check configuration",
        message: "missing canonical readiness configuration language",
      },
      {
        field: "readiness",
        snippet: "configured path: all applicable required checks are green at the current head",
        message: "missing configured-path current-head readiness rule",
      },
      {
        field: "readiness",
        snippet: "no-required-check path: at least one green CI/check run on the current head",
        message: "missing no-required-check current-head readiness rule",
      },
      {
        field: "readiness",
        snippet: "Older-head results never count.",
        message: "missing older-head staleness rule",
      },
      {
        field: "readiness",
        snippet: "Branch protection is not required.",
        message: "missing branch-protection clarification",
      },
      {
        field: "readiness",
        snippet: "Merge remains HITL by default.",
        message: "missing explicit merge-authorization clarification",
      },
    ]),
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

  issues.push(...validateReadinessExamples(blocks, contractText, promptText));

  if (issues.length > 0) {
    report(issues);
    process.exitCode = 1;
    return;
  }

  console.log(`review-gate contract ok: ${blocks.length} verdict examples, prompt schema aligned`);
}

main();
