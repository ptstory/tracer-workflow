import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = join(repoRoot, ".github/workflows/gate-readiness.yml");
const workflow = readFileSync(workflowPath, "utf8");

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

  test("evaluates only the current relevant check/status instance before readiness decisions", () => {
    const script = runScript();

    expect(script).toContain(`signal_check_runs_json="$(printf '%s' "$check_runs_json" | jq -c '[.[] | select(.app.slug != "github-actions" or .name != "gate-readiness")]')"`);
    expect(script).toContain("sort_by((.app.slug // \"\"), (.name // \"\"), (.run_number // 0), (.run_attempt // 0), (.run_started_at // .started_at // .created_at // \"\"), (.id // 0))");
    expect(script).toContain("group_by([(.app.slug // \"\"), (.name // \"\")])");
    expect(script).not.toContain("group_by(.name)");
    expect(script).toContain("group_by(.context)");
    expect(script).toContain("current_check_runs_json");
    expect(script).toContain("current_statuses_json");
  });
});
