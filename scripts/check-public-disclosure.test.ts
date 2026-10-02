import { describe, expect, test } from "bun:test";

import { scanText } from "./check-public-disclosure";

describe("public disclosure guard", () => {
  test("allows references to this public repository", () => {
    expect(scanText("doc.md", "ptstory/tracer-workflow")).toEqual([]);
  });

  test("allows this repository SSH remote suffix", () => {
    expect(scanText("doc.md", "git@github.com:ptstory/tracer-workflow.git")).toEqual([]);
  });

  test("rejects another owner-qualified repository", () => {
    const value = "ptstory" + "/private-project";
    expect(scanText("doc.md", value)).toEqual([
      { path: "doc.md", kind: "owner-qualified cross-repository reference" },
    ]);
  });

  test("rejects machine-local home paths", () => {
    const value = "/" + "Users/alice/Code/private-project";
    expect(scanText("doc.md", value)).toEqual([
      { path: "doc.md", kind: "macOS user-home path" },
    ]);
  });

  test("rejects agent session identifiers", () => {
    const value = "ses" + "_0123456789abcdef";
    expect(scanText("doc.md", value)).toEqual([
      { path: "doc.md", kind: "agent session identifier" },
    ]);
  });

  test("rejects credential-shaped strings without printing the secret", () => {
    const value = "ghp" + "_" + "A".repeat(30);
    expect(scanText("doc.md", value)).toEqual([
      { path: "doc.md", kind: "GitHub token" },
    ]);
  });
});
