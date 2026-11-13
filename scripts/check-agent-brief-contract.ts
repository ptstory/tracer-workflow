#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatCheckDiagnostic } from "./check-diagnostic";

export type AgentBriefContractFiles = {
  agentBrief: string;
  fromIssue: string;
  prBody: string;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const contractPaths = {
  agentBrief: "prompts/agent-brief.md",
  fromIssue: "skills/from-issue/SKILL.md",
  prBody: "skills/from-issue/references/pr-body-contract.md",
} as const;

function normalize(text: string): string {
  return text.replace(/`/g, "").replace(/\s+/g, " ").trim();
}

export function readAgentBriefContractFiles(root = repoRoot): AgentBriefContractFiles {
  return {
    agentBrief: readFileSync(resolve(root, contractPaths.agentBrief), "utf8"),
    fromIssue: readFileSync(resolve(root, contractPaths.fromIssue), "utf8"),
    prBody: readFileSync(resolve(root, contractPaths.prBody), "utf8"),
  };
}

export function validateAgentBriefContract(files: AgentBriefContractFiles): string[] {
  const errors: string[] = [];
  const agentBrief = normalize(files.agentBrief);
  const fromIssue = normalize(files.fromIssue);
  const prBody = normalize(files.prBody);

  const hasRevisionMarker = {
    agentBrief: /written-against:/i.test(files.agentBrief),
    fromIssue: /written-against|Brief written against/i.test(files.fromIssue),
    prBody: /Brief written against:/i.test(files.prBody),
  };

  if (!Object.values(hasRevisionMarker).some(Boolean)) {
    return errors;
  }

  for (const [surface, present] of Object.entries(hasRevisionMarker)) {
    if (!present) {
      errors.push(formatCheckDiagnostic(`${contractPaths[surface as keyof typeof contractPaths]} to contain the written-against revision contract`, "contract missing", "restore the required revision guidance"));
    }
  }

  const agentRequirements = [
    {
      ok: agentBrief.includes("written-against: <default-branch>@<full 40-char SHA>"),
      expected: `${contractPaths.agentBrief} to contain the canonical written-against line`,
    },
    {
      ok: agentBrief.includes("full 40-character commit SHA at brief time"),
      expected: `${contractPaths.agentBrief} to require the full 40-character default-branch SHA at brief time`,
    },
    {
      ok:
        agentBrief.includes("written-against: unresolved (reason)") &&
        agentBrief.includes("do not mark the issue ready-for-agent"),
      expected: `${contractPaths.agentBrief} to prevent ready-for-agent when revision is unresolved`,
    },
  ];

  const fromIssueRequirements = [
    {
      ok:
        fromIssue.includes("Brief written against") &&
        fromIssue.includes("written-against") &&
        fromIssue.includes("none recorded"),
      expected: `${contractPaths.fromIssue} to propagate the brief's written-against revision`,
    },
    {
      ok:
        fromIssue.includes("files named in the brief") &&
        fromIssue.includes("live default branch since that SHA"),
      expected: `${contractPaths.fromIssue} to compare named files against the live default branch since the brief SHA`,
    },
  ];

  const prBodyRequirements = [
    {
      ok: prBody.includes("- Brief written against: <SHA from the brief, or 'none recorded'>"),
      expected: `${contractPaths.prBody} to include the Brief written against evidence field`,
    },
  ];

  for (const requirement of [
    ...agentRequirements,
    ...fromIssueRequirements,
    ...prBodyRequirements,
  ]) {
    if (!requirement.ok) errors.push(formatCheckDiagnostic(requirement.expected, "requirement missing", "restore the missing agent-brief revision contract requirement"));
  }

  return errors;
}

function main(): void {
  const errors = validateAgentBriefContract(readAgentBriefContractFiles());
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log("agent-brief revision contract ok");
}

if (import.meta.main) {
  main();
}
