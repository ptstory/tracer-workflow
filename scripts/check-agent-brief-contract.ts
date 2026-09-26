#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
      errors.push(`${contractPaths[surface as keyof typeof contractPaths]}: missing written-against revision contract`);
    }
  }

  const agentRequirements = [
    {
      ok: agentBrief.includes("written-against: <default-branch>@<full 40-char SHA>"),
      message: `${contractPaths.agentBrief}: missing canonical written-against line`,
    },
    {
      ok: agentBrief.includes("full 40-character commit SHA at brief time"),
      message: `${contractPaths.agentBrief}: missing live default-branch SHA requirement`,
    },
    {
      ok:
        agentBrief.includes("written-against: unresolved (reason)") &&
        agentBrief.includes("do not mark the issue ready-for-agent"),
      message: `${contractPaths.agentBrief}: unresolved revisions must prevent ready-for-agent`,
    },
  ];

  const fromIssueRequirements = [
    {
      ok:
        fromIssue.includes("Brief written against") &&
        fromIssue.includes("written-against") &&
        fromIssue.includes("none recorded"),
      message: `${contractPaths.fromIssue}: missing brief revision propagation rule`,
    },
    {
      ok:
        fromIssue.includes("files named in the brief") &&
        fromIssue.includes("live default branch since that SHA"),
      message: `${contractPaths.fromIssue}: missing default-branch drift comparison rule`,
    },
  ];

  const prBodyRequirements = [
    {
      ok: prBody.includes("- Brief written against: <SHA from the brief, or 'none recorded'>"),
      message: `${contractPaths.prBody}: missing Brief written against evidence field`,
    },
  ];

  for (const requirement of [
    ...agentRequirements,
    ...fromIssueRequirements,
    ...prBodyRequirements,
  ]) {
    if (!requirement.ok) errors.push(requirement.message);
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
