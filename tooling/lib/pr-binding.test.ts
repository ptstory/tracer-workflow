import { expect, test } from "bun:test";
import { classifyGoverningIssueReferences } from "./pr-binding";

const repository = "ptstory/tracer-workflow";
const reference = (number: number, owner = "ptstory", name = "tracer-workflow") => ({ number, repository: { owner: { login: owner }, name } });

test("classifies one in-repository closing issue", () => {
  expect(classifyGoverningIssueReferences([reference(65)], repository)).toEqual({ kind: "valid", issueNumber: 65 });
});

test("deduplicates repeated references to the same in-repository issue", () => {
  expect(classifyGoverningIssueReferences([reference(65), reference(65)], repository)).toEqual({ kind: "valid", issueNumber: 65 });
});

test("distinguishes missing, malformed, ambiguous, and unsupported references", () => {
  expect(classifyGoverningIssueReferences([], repository)).toEqual({ kind: "missing" });
  expect(classifyGoverningIssueReferences([{ number: "65" }], repository)).toEqual({ kind: "malformed", detail: "closing issue reference 0 has incomplete identity" });
  expect(classifyGoverningIssueReferences([reference(65), reference(66)], repository)).toEqual({ kind: "ambiguous", issueNumbers: [65, 66] });
  expect(classifyGoverningIssueReferences([reference(65, "other")], repository)).toEqual({ kind: "unsupported", repositories: ["other/tracer-workflow"] });
});
