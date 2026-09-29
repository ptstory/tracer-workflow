import { describe, expect, test } from "bun:test";
import {
  clip,
  collapseBotNotices,
  correctionsFromTurns,
  isCorrection,
  isFixCommit,
  parseClaudeTranscript,
  type Signal,
} from "./mine-friction";

describe("correction heuristics", () => {
  test("flags common correction phrasing", () => {
    expect(isCorrection("No, don't edit the generated client")).toBe(true);
    expect(isCorrection("You forgot to run the targeted tests")).toBe(true);
    expect(isCorrection("Looks good, ship it")).toBe(false);
  });

  test("flags fix-like commit subjects only", () => {
    expect(isFixCommit("fix(review-gate): emit conforming verdicts")).toBe(true);
    expect(isFixCommit("Revert \"add poller\"")).toBe(true);
    expect(isFixCommit("feat: add gate-packet clipboard packer")).toBe(false);
  });

  test("clips and flattens whitespace", () => {
    expect(clip("a\n\n  b   c", 100)).toBe("a b c");
    expect(clip("abcdef", 3)).toBe("abc…");
  });
});

describe("collapseBotNotices", () => {
  const notice = (ref: string, sha: string): Signal => ({
    source: "thread-comment",
    ref,
    at: "2026-09-26",
    author: "github-actions[bot]",
    bot: true,
    text: `readiness for ${sha}: false`,
  });

  test("collapses repeated bot notices that differ only by numbers and SHAs", () => {
    const human: Signal = { source: "thread-comment", ref: "#1", at: "2026-09-26", author: "dev", bot: false, text: "readiness for abc1234def: false" };
    const { kept, collapsed } = collapseBotNotices([
      notice("#1", "abc1234def"),
      notice("#2", "0123456789a"),
      notice("#3", "fedcba98765"),
      human,
    ]);

    expect(kept).toEqual([human]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.count).toBe(3);
    expect(collapsed[0]!.refs).toEqual(["#1", "#2", "#3"]);
  });

  test("keeps bot notices below the repeat threshold", () => {
    const { kept, collapsed } = collapseBotNotices([notice("#1", "abc1234def"), notice("#2", "0123456789a")]);

    expect(kept).toHaveLength(2);
    expect(collapsed).toHaveLength(0);
  });
});

describe("Claude Code transcripts", () => {
  const lines = [
    { type: "user", timestamp: "2026-09-26T10:00:00Z", origin: { kind: "human" }, message: { content: "Add the endpoint" } },
    {
      type: "assistant",
      timestamp: "2026-09-26T10:00:05Z",
      message: { content: [{ type: "text", text: "Editing the generated client." }, { type: "tool_use", name: "Edit" }] },
    },
    { type: "user", timestamp: "2026-09-26T10:00:06Z", message: { content: [{ type: "tool_result" }] } },
    { type: "assistant", timestamp: "2026-09-26T10:00:07Z", message: { content: [{ type: "tool_use", name: "Bash" }] } },
    {
      type: "user",
      timestamp: "2026-09-26T10:01:00Z",
      origin: { kind: "human" },
      message: {
        content: [
          { type: "text", text: "<system-reminder>injected</system-reminder>" },
          { type: "text", text: "No, that file is generated. Edit the schema instead." },
        ],
      },
    },
    "not json",
  ]
    .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
    .join("\n");

  test("keeps human turns, drops tool results and injected blocks, merges streamed assistant lines", () => {
    const turns = parseClaudeTranscript(lines);

    expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    expect(turns[1]!.tools).toEqual(["Edit", "Bash"]);
    expect(turns[2]!.text).toBe("No, that file is generated. Edit the schema instead.");
  });

  test("pairs a correction with the agent action that preceded it", () => {
    const signals = correctionsFromTurns(parseClaudeTranscript(lines), "claude:abc", "2026-09-01", 200);

    expect(signals).toHaveLength(1);
    expect(signals[0]!.context).toBe("tools=Edit,Bash Editing the generated client.");
    expect(signals[0]!.text).toContain("that file is generated");
  });

  test("ignores corrections before the window", () => {
    expect(correctionsFromTurns(parseClaudeTranscript(lines), "claude:abc", "2026-09-27", 200)).toHaveLength(0);
  });
});
