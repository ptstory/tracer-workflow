import { expect, test } from "bun:test";
import { classifyGoverningIssueReferences } from "./pr-binding";

const repository = "ptstory/tracer-workflow";
const reference = (number: number, owner = "ptstory", name = "tracer-workflow") => ({ number, repository: { owner: { login: owner }, name } });

test("classifies one body reference corroborated by GitHub", () => {
  expect(classifyGoverningIssueReferences([reference(65)], repository, "Closes #65")).toEqual({ kind: "valid", issueNumber: 65 });
});

test("requires a recognized body reference even when GitHub reports a manually linked issue", () => {
  expect(classifyGoverningIssueReferences([reference(65)], repository, "Related to #65")).toEqual({ kind: "missing" });
  expect(classifyGoverningIssueReferences([reference(65)], repository, "Example:\n~~~text\nCloses #65\n~~~")).toEqual({ kind: "missing" });
  expect(classifyGoverningIssueReferences([reference(65)], repository, "Example:\n```text\nCloses #65\n```")).toEqual({ kind: "missing" });
});

test("accepts GitHub's colon form for a closing keyword", () => {
  expect(classifyGoverningIssueReferences([reference(65)], repository, "Closes: #65")).toEqual({ kind: "valid", issueNumber: 65 });
});

test("rejects fenced blocks that are not properly closed", () => {
  expect(classifyGoverningIssueReferences([reference(65)], repository, "~~~text\nCloses #65")).toEqual({
    kind: "malformed",
    detail: "pull request body contains an unclosed fenced code block",
  });
});

test("requires body and GitHub reference identities to agree", () => {
  expect(classifyGoverningIssueReferences([reference(66)], repository, "Closes #65")).toEqual({
    kind: "malformed",
    detail: "pull request body closes #65, but GitHub reports no matching in-repository closing issue reference",
  });
});

test("rejects unsupported, multiple, and malformed body references", () => {
  expect(classifyGoverningIssueReferences([], repository, "")).toEqual({ kind: "missing" });
  expect(classifyGoverningIssueReferences([reference(65)], repository, "The planned fix resolves #65 in prose.")).toEqual({ kind: "missing" });
  expect(classifyGoverningIssueReferences([reference(65, "other", "repo")], repository, "Closes other/repo#65")).toEqual({ kind: "unsupported", repositories: ["other/repo"] });
  expect(classifyGoverningIssueReferences([reference(65, "other", "repo")], repository, "Closes #65")).toEqual({ kind: "unsupported", repositories: ["other/repo"] });
  expect(classifyGoverningIssueReferences([], repository, "Closes #65").kind).toBe("malformed");
  expect(classifyGoverningIssueReferences([reference(65), reference(66)], repository, "Closes #65\nFixes #66")).toEqual({ kind: "ambiguous", issueNumbers: [65, 66] });
  expect(classifyGoverningIssueReferences([{ number: "65" }], repository, "Closes #65")).toEqual({ kind: "malformed", detail: "closing issue reference 0 has incomplete identity" });
  expect(classifyGoverningIssueReferences([reference(Number.MAX_SAFE_INTEGER + 1)], repository, "Closes #65").kind).toBe("malformed");
});
