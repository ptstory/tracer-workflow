import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = join(repoRoot, ".github/workflows/gate-readiness.yml");
const workflow = readFileSync(workflowPath, "utf8");
const callerTemplate = readFileSync(join(repoRoot, "templates/gate-labels.yml"), "utf8");

function runScript(): string {
  const lines = workflow.split("\n");
  const runIndex = lines.findIndex((line) => line.trim() === "run: |");
  if (runIndex < 0) throw new Error("could not locate Evaluate readiness script");

  const scriptLines: string[] = [];
  const indent = lines.slice(runIndex + 1).find((line) => line.trim().length > 0)?.match(/^ */)?.[0].length ?? 0;

  for (const line of lines.slice(runIndex + 1)) {
    if (line.trim().length === 0) {
      scriptLines.push("");
      continue;
    }

    if (!line.startsWith(" ".repeat(indent))) break;
    scriptLines.push(line.slice(indent));
  }

  return scriptLines.join("\n");
}

describe(".github/workflows/gate-readiness.yml", () => {
  test("uses the workflow token secret for gh api access", () => {
    expect(workflow).toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    expect(workflow).not.toContain("GH_TOKEN: ${{ github.token }}");
  });

  test("requests write access for issue comment writeback and PR comment writeback while keeping metadata lookup separated", () => {
    expect(workflow).toContain("issues: write # issue comments + labels");
    expect(workflow).toContain("pull-requests: write # PR comment writeback; workflow_call metadata lookup stays read-only via gh api");
    expect(workflow).toContain("issue comments + labels");
    expect(workflow).toContain("PR comment writeback");
    expect(workflow).toContain("workflow_call metadata lookup stays read-only via gh api");
  });

  test("is self-contained and accepts trusted reviewer logins from the caller", () => {
    expect(workflow).toContain("reviewer-logins:");
    expect(workflow).toContain("${{ inputs.reviewer-logins || vars.TRACER_REVIEWER_LOGINS }}");
    expect(workflow).toContain("inputs.reviewer-logins || vars.TRACER_REVIEWER_LOGINS");
    expect(workflow).not.toContain("actions/checkout");
    expect(workflow).toContain('gh api "repos/$repo/');
  });

  test("caller template only reevaluates for review-gate PR comments", () => {
    expect(callerTemplate).toContain("github.event.issue.pull_request &&");
    expect(callerTemplate).toContain("startsWith(github.event.comment.body, '## review-gate:')");
  });

  test("tolerates a concurrent already_exists response while creating labels", () => {
    const script = runScript();
    expect(script).toContain('"already_exists"');
    expect(script).toContain('"HTTP 422"');
  });

  test("re-reads the live PR head before every comment and label write", () => {
    const script = runScript();
    const recheck = script.indexOf("(live head re-check)");
    expect(recheck).toBeGreaterThan(-1);
    for (const write of ['-X PATCH "repos/$repo/issues/comments/', '-X POST "repos/$repo/issues/$pr_number/comments"', '-X POST "repos/$repo/issues/$pr_number/labels"', '-X DELETE "repos/$repo/issues/$pr_number/labels/', '-X POST "repos/$repo/labels"']) {
      const first = script.indexOf(write);
      expect(first, write).toBeGreaterThan(recheck);
    }
  });

  test("deletes verdict labels only when the PR already has them", () => {
    const script = runScript();
    expect(script).toContain('pr_label_json="$(printf \'%s\' "$live_pr_json" | jq -c \'[.labels // [] | .[] | .name]\')"');
    expect(script).toContain('existing_verdict_labels="$pr_label_json"');
    expect(script).toContain('elif printf \'%s\' "$existing_verdict_labels" | jq -e --arg label "$label" \'index($label) != null\' >/dev/null; then');
  });

  test("evaluates only the current relevant check/status instance before readiness decisions", () => {
    const script = runScript();

    expect(script).toContain("gh_api() {");
    expect(script).toContain("gate-readiness: gh api");
    expect(script).toContain(`signal_check_runs_json="$(printf '%s' "$check_runs_json" | jq -c '[.[] | select(.app.slug != "github-actions" or .name != "gate-readiness")]')"`);
    expect(script).toContain("sort_by((.app.slug // \"\"), (.name // \"\"), (.run_number // 0), (.run_attempt // 0), (.run_started_at // .started_at // .created_at // \"\"), (.id // 0))");
    expect(script).toContain("group_by([(.app.slug // \"\"), (.name // \"\")])");
    expect(script).not.toContain("group_by(.name)");
    expect(script).toContain("group_by(.context)");
    expect(script).toContain("current_check_runs_json");
    expect(script).toContain("current_statuses_json");
  });
});
