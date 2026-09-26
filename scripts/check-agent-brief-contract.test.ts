import { describe, expect, test } from "bun:test";

import {
  readAgentBriefContractFiles,
  validateAgentBriefContract,
  type AgentBriefContractFiles,
} from "./check-agent-brief-contract";

const revised: AgentBriefContractFiles = {
  agentBrief: [
    "Resolve the live default branch and its full 40-character commit SHA at brief time;",
    "do not mark the issue `ready-for-agent` when that cannot be resolved.",
    "",
    "written-against: <default-branch>@<full 40-char SHA>",
    "",
    "written-against: unresolved (reason)",
  ].join("\n"),
  fromIssue: [
    "Copy the brief's `written-against` SHA into `Brief written against`, or use `none recorded`.",
    "Compare the files named in the brief against the live default branch since that SHA.",
  ].join("\n"),
  prBody: "- Brief written against: <SHA from the brief, or 'none recorded'>",
};

describe("agent brief revision contract", () => {
  test("live repository contract is internally consistent", () => {
    expect(validateAgentBriefContract(readAgentBriefContractFiles())).toEqual([]);
  });

  test("accepts the legacy contract before migration", () => {
    expect(
      validateAgentBriefContract({
        agentBrief: "legacy agent brief",
        fromIssue: "legacy execution contract",
        prBody: "legacy PR evidence contract",
      }),
    ).toEqual([]);
  });

  test("accepts a coherent written-against contract with Markdown code spans", () => {
    expect(validateAgentBriefContract(revised)).toEqual([]);
  });

  test("rejects partial written-against migrations", () => {
    for (const surface of ["agentBrief", "fromIssue", "prBody"] as const) {
      const partial = { ...revised, [surface]: "legacy surface" };
      const errors = validateAgentBriefContract(partial);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  test("rejects semantic drift inside the revised contract", () => {
    expect(
      validateAgentBriefContract({
        ...revised,
        agentBrief: revised.agentBrief.replace(
          "do not mark the issue `ready-for-agent`",
          "continue as `ready-for-agent`",
        ),
      }),
    ).toContain(
      "prompts/agent-brief.md: unresolved revisions must prevent ready-for-agent",
    );

    expect(
      validateAgentBriefContract({
        ...revised,
        fromIssue: revised.fromIssue.replace(
          "live default branch since that SHA",
          "current branch",
        ),
      }),
    ).toContain(
      "skills/from-issue/SKILL.md: missing default-branch drift comparison rule",
    );
  });
});
