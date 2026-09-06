import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = join(repoRoot, ".github/workflows/gate-readiness-reevaluate.yml");
const workflow = readFileSync(workflowPath, "utf8");

describe("gate-readiness reevaluation workflow", () => {
  test("re-evaluates after CI completes", () => {
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("workflows: [CI]");
    expect(workflow).toContain("types: [completed]");
    expect(workflow).toContain("uses: ./.github/workflows/gate-readiness.yml");
    expect(workflow).toContain("needs.resolve-ci-pr.outputs.pr-number");
  });

  test("resolves push-triggered CI runs back to an open PR by head SHA", () => {
    expect(workflow).toContain(".workflow_run.pull_requests[0].number // empty");
    expect(workflow).toContain(".workflow_run.head_sha // empty");
    expect(workflow).toContain('gh api "repos/$REPOSITORY/commits/$head_sha/pulls"');
    expect(workflow).toContain('select(.state == "open")');
  });

  test("re-evaluates only review-gate PR comments and cannot loop on its own bot comment", () => {
    expect(workflow).toContain("issue_comment:");
    expect(workflow).toContain("types: [created, edited]");
    expect(workflow).toContain("github.event.issue.pull_request");
    expect(workflow).toContain("startsWith(github.event.comment.body, '## review-gate:')");
    expect(workflow).toContain("pr-number: ${{ github.event.issue.number }}");
    expect(workflow).not.toContain("gate-readiness:bot");
  });

  test("preserves the called workflow permissions", () => {
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("pull-requests: write");
    expect(workflow).toContain("checks: read");
    expect(workflow).toContain("statuses: read");
  });
});
