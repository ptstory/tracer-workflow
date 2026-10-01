#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

type Finding = { path: string; kind: string };

const PUBLIC_OWNER = "ptstory";
const PUBLIC_REPO = "tracer-workflow";

const sensitivePatterns: Array<[string, RegExp]> = [
  ["macOS user-home path", /\/Users\/[^\/\s"'\`<>]+(?:\/[^\s"'\`<>]*)?/g],
  ["Linux user-home path", /\/home\/[^\/\s"'\`<>]+(?:\/[^\s"'\`<>]*)?/g],
  ["agent session identifier", /\bses_[A-Za-z0-9_-]{8,}\b/g],
  ["GitHub token", /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g],
  ["OpenAI-like secret", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["private key header", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["bearer credential", /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/g],
];

function scanText(path: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const repoPattern = new RegExp(`\\b${PUBLIC_OWNER}\\/([A-Za-z0-9._-]+)\\b`, "g");

  for (const match of text.matchAll(repoPattern)) {
    if (match[1] !== PUBLIC_REPO && match[1] !== `${PUBLIC_REPO}.git`) {
      findings.push({ path, kind: "owner-qualified cross-repository reference" });
    }
  }

  for (const [kind, pattern] of sensitivePatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push({ path, kind });
  }

  return findings;
}

function trackedTextFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
}

function scanRepository(): Finding[] {
  const findings: Finding[] = [];
  for (const path of trackedTextFiles()) {
    const buffer = readFileSync(path);
    if (buffer.includes(0)) continue;
    findings.push(...scanText(path, buffer.toString("utf8")));
  }
  return findings;
}

function main(): void {
  const findings = scanRepository();
  if (findings.length === 0) {
    console.log("public disclosure check passed");
    return;
  }

  for (const finding of findings) console.error(`${finding.path}: ${finding.kind}`);
  process.exit(1);
}

if (import.meta.main) main();

export { scanRepository, scanText };
