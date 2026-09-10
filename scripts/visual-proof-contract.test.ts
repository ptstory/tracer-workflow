import { describe, expect, test } from "bun:test";
import { assessVisualProof, findCurrentProducerProof, parseVisualProofComment } from "./visual-proof-contract";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OLD_HEAD = "89abcdef0123456789abcdef0123456789abcdef";

function provided(head = HEAD): string {
  return `## visual-proof: provided\n\nhead-sha: ${head}\nsurface: Storybook / ActivityCard\nclaim: Standalone component renders the populated state.\n\n![proof](https://github.com/user-attachments/assets/example)`;
}

function nA(head = HEAD): string {
  return `## visual-proof: n/a\n\nhead-sha: ${head}\nsurface: n/a\nclaim: No render path exists without the later integration slice.\n\nAdding product wiring would exceed this issue.`;
}

describe("visual-proof producer comment", () => {
  test("parses a current provided comment", () => {
    expect(parseVisualProofComment(provided())?.state).toBe("provided");
    expect(findCurrentProducerProof([provided()], HEAD).kind).toBe("provided");
  });

  test("treats older-head proof as stale", () => {
    expect(findCurrentProducerProof([provided(OLD_HEAD)], HEAD).kind).toBe("stale");
  });

  test("parses a current n/a producer claim", () => {
    expect(findCurrentProducerProof([nA()], HEAD).kind).toBe("n/a");
  });

  test("ignores malformed proof as missing", () => {
    const malformed = `## visual-proof: provided\n\nhead-sha: short\nsurface: /\nclaim: nope\n\nproof`;
    expect(findCurrentProducerProof([malformed], HEAD).kind).toBe("missing");
  });
});

describe("reviewer visual-proof classification", () => {
  test("current sufficient scope-faithful proof is PROVIDED", () => {
    expect(assessVisualProof({
      visuallyInspectable: true,
      reasonablyRenderable: true,
      currentProducerProof: findCurrentProducerProof([provided()], HEAD),
      proofSufficient: true,
      scopeFaithful: true,
    })).toBe("PROVIDED");
  });

  test("stale proof is MISSING for renderable visual work", () => {
    expect(assessVisualProof({
      visuallyInspectable: true,
      reasonablyRenderable: true,
      currentProducerProof: findCurrentProducerProof([provided(OLD_HEAD)], HEAD),
      proofSufficient: true,
      scopeFaithful: true,
    })).toBe("MISSING");
  });

  test("justified n/a is N/A when rendering would require out-of-scope integration", () => {
    expect(assessVisualProof({
      visuallyInspectable: true,
      reasonablyRenderable: false,
      currentProducerProof: findCurrentProducerProof([nA()], HEAD),
    })).toBe("N/A");
  });

  test("unjustified producer n/a is MISSING when the work is reasonably renderable", () => {
    expect(assessVisualProof({
      visuallyInspectable: true,
      reasonablyRenderable: true,
      currentProducerProof: findCurrentProducerProof([nA()], HEAD),
    })).toBe("MISSING");
  });

  test("missing proof is MISSING for renderable visual work", () => {
    expect(assessVisualProof({
      visuallyInspectable: true,
      reasonablyRenderable: true,
      currentProducerProof: { kind: "missing" },
    })).toBe("MISSING");
  });

  test("non-visual work is N/A without a screenshot requirement", () => {
    expect(assessVisualProof({
      visuallyInspectable: false,
      reasonablyRenderable: false,
      currentProducerProof: { kind: "missing" },
    })).toBe("N/A");
  });

  test("scope-overclaim is MISSING even with current media", () => {
    expect(assessVisualProof({
      visuallyInspectable: true,
      reasonablyRenderable: true,
      currentProducerProof: findCurrentProducerProof([provided()], HEAD),
      proofSufficient: true,
      scopeFaithful: false,
    })).toBe("MISSING");
  });
});
