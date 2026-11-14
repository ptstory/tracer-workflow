import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = join(repoRoot, ".github/workflows/review-gate-auto-merge.yml");
const reevaluateWorkflowPath = join(repoRoot, ".github/workflows/gate-readiness-reevaluate.yml");
const readmePath = join(repoRoot, "tooling/review-gate-auto-merge/README.md");
const workflow = readFileSync(workflowPath, "utf8");
const reevaluateWorkflow = readFileSync(reevaluateWorkflowPath, "utf8");
const readme = readFileSync(readmePath, "utf8");
const headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const otherSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const fineGrainedToken = "fine-grained-token";
const createdAt = "2026-11-13T12:00:00Z";
const reportUpdatedAt = "2026-11-13T12:00:01Z";

type CheckRun = { name: string; status: string; conclusion: string | null; app: { id: number; slug?: string; name?: string } };
type Fixture = {
  eventName?: "issue_comment" | "workflow_run" | "check_run" | "repository_dispatch";
  verdictAuthor?: string;
  verdictState?: string;
  verdictHeadSha?: string;
  verdictUpdatedAt?: string;
  eventUpdatedAt?: string;
  reportVerdictState?: string;
  reportHeadSha?: string;
  reportUpdatedAt?: string;
  labels?: string[];
  draft?: boolean;
  checks?: CheckRun[];
  statusContexts?: { context: string; state: string }[];
  reviewerLogins?: string;
  eventAuthor?: string;
  requiredChecks?: { context: string; app_id: number }[];
  requiredChecksReadable?: boolean;
  rulesAvailable?: boolean;
  branchProtected?: boolean;
  pullRequestOpen?: boolean;
  mergeToken?: string | null;
  workflowRunConclusion?: string;
  changedFiles?: string[];
  prBody?: string;
};

type HarnessResult = {
  status: number;
  stdout: string;
  stderr: string;
  log: { command: string; args: string[]; body?: string; auth?: string }[];
  comments: { user: { login: string }; body: string; created_at: string }[];
};

function extractRunScript(): string {
  const lines = workflow.split("\n");
  const runIndex = lines.findIndex((line) => line.trim() === "run: |");
  if (runIndex < 0) throw new Error("could not locate auto-merge script");
  const indent = lines[runIndex + 1].match(/^ */)?.[0].length ?? 0;
  const scriptLines: string[] = [];
  for (const line of lines.slice(runIndex + 1)) {
    if (line.trim() && !line.startsWith(" ".repeat(indent))) break;
    scriptLines.push(line.trim() ? line.slice(indent) : "");
  }
  return scriptLines.join("\n");
}

function makeHarness(fixture: Fixture): HarnessResult {
  const root = mkdtempSync(join(tmpdir(), "review-gate-auto-merge-"));
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const eventPath = join(root, "event.json");
  const scriptPath = join(root, "workflow.sh");
  const logPath = join(root, "gh.log");
  const fixturePath = join(root, "fixture.json");
  const verdictState = fixture.verdictState ?? "merge-candidate";
  const verdictHead = fixture.verdictHeadSha ?? headSha;
  const reportState = fixture.reportVerdictState ?? verdictState;
  const reportHead = fixture.reportHeadSha ?? verdictHead;
  const readinessState = fixture.reportHeadSha && fixture.reportHeadSha !== headSha ? "stale" : reportHead === headSha ? "current" : "stale";
  const checks = fixture.requiredChecks ?? [{ context: "required-check", app_id: 1 }];
  const checkRuns = fixture.checks ?? (checks.length ? checks.map(({ context, app_id }) => ({ name: context, status: "completed", conclusion: "success", app: { id: app_id } })) : [{ name: "test", status: "completed", conclusion: "success", app: { id: 1, slug: "github-actions", name: "GitHub Actions" } }]);
  const verdict = `## review-gate: ${verdictState}\nhead-sha: ${verdictHead}\nreview-round: 0\nreviewed-files: 1\nblocking-set:${verdictState === "needs-fix" ? " tooling/file.ts" : ""}\nnext-action: ${verdictState === "merge-candidate" ? `gh pr merge 98 --squash --match-head-commit ${verdictHead}` : verdictState === "needs-fix" ? "from-pr-review https://github.com/acme/repo/pull/98" : "gh pr view 98 --web"}\n`;
  const comments = [{
    id: 901,
    user: { login: "github-actions[bot]" },
    body: `<!-- gate-readiness:bot -->\n## gate-readiness\n\n- PR: #98\n- head-sha: ${headSha}\n- review gate state: ${readinessState}\n- review gate verdict: ${reportState}\n- latest marker parse: valid\n- latest valid verdict: ${reportState} (head-sha: ${reportHead}, review-round: 0, reviewed-files: 1)\n- readiness: true\n`,
    created_at: reportUpdatedAt,
    updated_at: fixture.reportUpdatedAt ?? reportUpdatedAt,
  }, {
    id: 902,
    user: { login: fixture.verdictAuthor ?? "reviewer" },
    body: verdict,
    created_at: createdAt,
    updated_at: fixture.verdictUpdatedAt ?? fixture.eventUpdatedAt ?? createdAt,
  }];
  const eventName = fixture.eventName ?? "issue_comment";
  const event = eventName === "issue_comment"
    ? {
        issue: { number: 98, pull_request: { url: "https://api.github.com/repos/acme/repo/pulls/98" } },
        comment: {
          id: 902,
          user: { login: fixture.eventAuthor ?? fixture.verdictAuthor ?? "reviewer" },
          body: verdict,
          created_at: createdAt,
          updated_at: fixture.eventUpdatedAt ?? fixture.verdictUpdatedAt ?? createdAt,
        },
      }
    : eventName === "workflow_run"
      ? {
          workflow_run: {
            event: "issue_comment",
            name: "Gate Readiness Reevaluate",
            head_sha: headSha,
            updated_at: reportUpdatedAt,
            completed_at: reportUpdatedAt,
            conclusion: fixture.workflowRunConclusion ?? "success",
            pull_requests: [{ number: 98 }],
          },
        }
      : eventName === "repository_dispatch"
        ? { action: "review-gate-readiness-completed", client_payload: { pull_request_number: 98 } }
        : eventName === "check_run"
          ? {
              check_run: {
                head_sha: headSha,
                completed_at: reportUpdatedAt,
                pull_requests: [{ number: 98 }],
              },
            }
          : {
            check_run: {
              head_sha: headSha,
              completed_at: reportUpdatedAt,
              pull_requests: [{ number: 98 }],
            },
          };
  const mockData = {
    pr: {
      state: fixture.pullRequestOpen === false ? "closed" : "open",
      head: { sha: headSha },
      base: { ref: "main" },
      draft: fixture.draft ?? false,
      html_url: "https://github.com/acme/repo/pull/98",
      body: fixture.prBody ?? `## Evidence\n\n- Head SHA: ${headSha}\n- Test node IDs exercising changed paths:\n  - \`test exercises changed paths\`\n`,
      labels: (fixture.labels ?? ["gate:merge-candidate"]).map((name) => ({ name })),
      merged: false,
      merge_commit_sha: null as string | null,
    },
    checks: checkRuns,
    changedFiles: fixture.changedFiles ?? ["tooling/review-gate-auto-merge/review-gate-auto-merge.behavior.test.ts"],
    statuses: fixture.statusContexts ?? [],
    requiredChecks: checks,
    requiredChecksReadable: fixture.requiredChecksReadable ?? true,
    rulesAvailable: fixture.rulesAvailable ?? true,
    branchProtected: fixture.branchProtected ?? true,
    comments,
  };
  writeFileSync(eventPath, JSON.stringify(event), "utf8");
  writeFileSync(fixturePath, JSON.stringify(mockData), "utf8");
  writeFileSync(logPath, "", "utf8");
  writeFileSync(scriptPath, extractRunScript(), "utf8");
  chmodSync(scriptPath, 0o755);
  const ghStub = `#!/usr/bin/env node
const fs = require("node:fs");
const fixturePath = ${JSON.stringify(fixturePath)};
const logPath = ${JSON.stringify(logPath)};
const data = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const args = process.argv.slice(2);
const command = args[0] ?? "";
const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
const methodIndex = args.indexOf("-X");
const method = methodIndex >= 0 ? args[methodIndex + 1] : "GET";
const bodyArg = args.find((arg) => arg.startsWith("body="));
const auth = process.env.GH_TOKEN === ${JSON.stringify(fineGrainedToken)} ? "merge-token" : process.env.GH_TOKEN === "github-token" ? "github-token" : "none";
const entry = { command, args, auth, ...(bodyArg ? { body: bodyArg.slice(5) } : {}) };
fs.appendFileSync(logPath, JSON.stringify(entry) + "\\n");
if (command === "pr" && args[1] === "ready") {
  data.pr.draft = false;
  fs.writeFileSync(fixturePath, JSON.stringify(data));
  process.exit(0);
}
if (command === "pr" && args[1] === "merge") {
  if (auth !== "merge-token") process.exit(1);
  data.pr.merged = true;
  data.pr.state = "closed";
  data.pr.merge_commit_sha = "cccccccccccccccccccccccccccccccccccccccc";
  fs.writeFileSync(fixturePath, JSON.stringify(data));
  process.exit(0);
}
if (endpoint.includes("/pulls/") && endpoint.includes("/files?")) {
  process.stdout.write(JSON.stringify(data.changedFiles.map((filename) => ({ filename }))));
} else if (endpoint.includes("/pulls/")) {
  process.stdout.write(JSON.stringify(data.pr));
} else if (endpoint.includes("/issues/") && endpoint.includes("/comments") && method === "GET") {
  process.stdout.write(JSON.stringify(data.comments));
} else if (endpoint.includes("/issues/") && endpoint.includes("/comments") && method === "POST") {
  const commentBody = bodyArg ? bodyArg.slice(5) : "";
  data.comments.push({ user: { login: "github-actions[bot]" }, body: commentBody, created_at: "2026-11-13T12:01:00Z" });
  fs.writeFileSync(fixturePath, JSON.stringify(data));
  process.stdout.write("{}\\n");
} else if (endpoint.includes("/rules/branches/") && !data.rulesAvailable) {
  process.stderr.write("HTTP 403: Upgrade to GitHub Pro or make this repository public to enable this feature.\\n");
  process.exit(1);
} else if (endpoint.includes("/rules/branches/")) {
  process.stdout.write("[]");
} else if (endpoint.includes("/branches/")) {
  if (!data.requiredChecksReadable || auth !== "merge-token") {
    process.stderr.write("Resource not accessible by integration\\n");
    process.exit(1);
  }
  const required = data.requiredChecks.length
    ? { checks: data.requiredChecks.map(({ context, app_id }) => ({ context, app_id })), contexts: [] }
    : null;
  process.stdout.write(JSON.stringify({ protected: data.branchProtected, protection: { required_status_checks: required } }));
} else if (endpoint.includes("/check-runs")) {
  process.stdout.write(JSON.stringify({ check_runs: data.checks }));
} else if (endpoint.includes("/statuses")) {
  process.stdout.write(JSON.stringify(data.statuses));
} else {
  process.stdout.write("{}\\n");
}
`;
  const ghPath = join(binDir, "gh");
  writeFileSync(ghPath, ghStub, "utf8");
  chmodSync(ghPath, 0o755);
  const result = spawnSync("bash", [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      GH_TOKEN: "github-token",
      TRACER_MERGE_TOKEN: fixture.mergeToken === undefined ? fineGrainedToken : fixture.mergeToken ?? "",
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventPath,
      REPOSITORY: "acme/repo",
      TRACER_REVIEWER_LOGINS: fixture.reviewerLogins ?? "reviewer",
      LABEL_WAIT_ATTEMPTS: "0",
      LABEL_WAIT_INTERVAL_SECONDS: "0",
    },
    encoding: "utf8",
  });
  const persisted = JSON.parse(readFileSync(fixturePath, "utf8")) as typeof mockData;
  const rawLog = readFileSync(logPath, "utf8");
  const eventJson = readFileSync(eventPath, "utf8");
  const ghLog = rawLog.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  rmSync(root, { recursive: true, force: true });
  return { status: result.status ?? 1, stdout: `${result.stdout}\n${rawLog}\n${eventJson}`, stderr: result.stderr, log: ghLog, comments: persisted.comments };
}

function mergeCalls(result: HarnessResult) {
  return result.log.filter((entry) => entry.command === "pr" && entry.args[1] === "merge");
}

function stopComments(result: HarnessResult) {
  return result.log.filter((entry) => entry.command === "api" && entry.args.includes("-X") && entry.args[entry.args.indexOf("-X") + 1] === "POST" && entry.args.some((arg) => arg.includes("/issues/98/comments")));
}

describe(".github/workflows/review-gate-auto-merge.yml behavior", () => {
  test("merges only a current allowlisted candidate after required checks pass using the repository token", () => {
    const result = makeHarness({});
    expect(result.status, `${result.stderr}\n${result.stdout}\n${JSON.stringify(result.log)}`).toBe(0);
    expect(mergeCalls(result)).toHaveLength(1);
    expect(mergeCalls(result)[0].args).toContain("--squash");
    expect(mergeCalls(result)[0].args).toContain("--delete-branch");
    expect(mergeCalls(result)[0].args).toContain("--match-head-commit");
    expect(mergeCalls(result)[0].args).toContain(headSha);
    expect(mergeCalls(result)[0].auth).toBe("merge-token");
    expect(result.log.filter((entry) => entry.args.some((arg) => arg.includes("/branches/"))).every((entry) => entry.auth === "merge-token")).toBe(true);
    expect(result.comments.at(-1)?.body).toContain("Merge SHA: cccccccccccccccccccccccccccccccccccccccc");
  });

  test("marks a draft ready before using the guarded squash merge", () => {
    const result = makeHarness({ draft: true });
    expect(result.status, result.stderr).toBe(0);
    const readyIndex = result.log.findIndex((entry) => entry.command === "pr" && entry.args[1] === "ready");
    const mergeIndex = result.log.findIndex((entry) => entry.command === "pr" && entry.args[1] === "merge");
    expect(readyIndex).toBeGreaterThanOrEqual(0);
    expect(mergeIndex).toBeGreaterThan(readyIndex);
  });

  test("re-evaluates after Gate Readiness Reevaluate completes from a workflow_run", () => {
    const result = makeHarness({ eventName: "workflow_run" });
    expect(result.status, `${result.stderr}\n${result.stdout}\n${JSON.stringify(result.log)}`).toBe(0);
    expect(mergeCalls(result)).toHaveLength(1);
    expect(workflow).not.toContain("workflow_run.event == 'pull_request'");
  });

  test("accepts the authenticated readiness-completed dispatch", () => {
    const result = makeHarness({ eventName: "repository_dispatch" });
    expect(result.status, `${result.stderr}\n${result.stdout}\n${JSON.stringify(result.log)}`).toBe(0);
    expect(mergeCalls(result)).toHaveLength(1);
    expect(reevaluateWorkflow).toContain("name: Resolve PR for completed CI run");
    expect(reevaluateWorkflow).toContain("GH_TOKEN: ${{ secrets.TRACER_MERGE_TOKEN }}");
    expect(reevaluateWorkflow).toContain("event_type=review-gate-readiness-completed");
  });

  test("documents the exact fine-grained merge-token permissions", () => {
    expect(readme).toContain("`TRACER_MERGE_TOKEN`");
    expect(readme).toContain("**Administration: read**");
    expect(readme).toContain("**Contents: read and write**");
    expect(readme).toContain("**Pull requests: read and write**");
    expect(readme).toContain("never falls back to\n`GITHUB_TOKEN`");
  });

  test("uses the shared verdict parser and current PR labels", () => {
    expect(workflow).toContain("bun tooling/lib/verdict-cli.ts");
    expect(workflow).toContain(".labels[]?.name");
    const result = makeHarness({});
    expect(mergeCalls(result)).toHaveLength(1);
  });

  test("does not merge a stale verdict and names the mismatch", () => {
    const result = makeHarness({ verdictHeadSha: otherSha });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(stopComments(result).some((entry) => entry.body?.includes(`verdict head ${otherSha} is stale`))).toBe(true);
  });

  test("an edited revoked verdict overrides a stale merge-candidate report", () => {
    const result = makeHarness({ verdictState: "needs-fix", reportVerdictState: "merge-candidate", verdictUpdatedAt: "2026-11-13T12:02:00Z", eventUpdatedAt: "2026-11-13T12:02:00Z" });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(result.comments.some((comment) => comment.body.includes("Review Gate readiness report does not reflect the latest trusted verdict revision"))).toBe(true);
  });

  test("does not merge an edited current verdict while the prior readiness report is stale", () => {
    const result = makeHarness({ verdictUpdatedAt: "2026-11-13T12:02:00Z", eventUpdatedAt: "2026-11-13T12:02:00Z", reportUpdatedAt: reportUpdatedAt });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(result.comments.some((comment) => comment.body.includes("readiness report predates the latest trusted verdict revision"))).toBe(true);
  });

  test("does not merge when the verdict author is not allowlisted", () => {
    const result = makeHarness({ verdictAuthor: "attacker", eventAuthor: "attacker" });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(result.comments.some((comment) => comment.body.includes("verdict author attacker is not allowlisted"))).toBe(true);
  });

  test("fails closed with a named stop when TRACER_MERGE_TOKEN is missing", () => {
    const result = makeHarness({ mergeToken: null });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(stopComments(result).some((entry) => entry.body?.includes("TRACER_MERGE_TOKEN is missing"))).toBe(true);
    expect(result.log.some((entry) => entry.args.some((arg) => arg.includes("/branches/")))).toBe(false);
  });

  test("does not fall back to GITHUB_TOKEN when required-check authorization is denied", () => {
    const result = makeHarness({ requiredChecksReadable: false });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(result.log.filter((entry) => entry.args.some((arg) => arg.includes("/branches/"))).every((entry) => entry.auth === "merge-token")).toBe(true);
    expect(result.log.some((entry) => entry.command === "pr" && entry.args[1] === "merge" && entry.auth === "github-token")).toBe(false);
    expect(result.comments.some((comment) => comment.body.includes("using TRACER_MERGE_TOKEN"))).toBe(true);
  });

  test.each([
    ["pending", [{ name: "required-check", status: "in_progress", conclusion: null, app: { id: 1 } }], "required check required-check is in_progress"],
    ["failed", [{ name: "required-check", status: "completed", conclusion: "failure", app: { id: 1 } }], "required check required-check completed with failure"],
    ["missing", [], "required check required-check from app 1 is missing"],
  ] as const)("does not merge when a required check is %s", (_state, checks, expectedReason) => {
    const result = makeHarness({ checks: [...checks] });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(stopComments(result).some((entry) => entry.body?.includes(expectedReason))).toBe(true);
  });

  test("treats classic app_id -1 as any app for a successful required check", () => {
    const result = makeHarness({
      requiredChecks: [{ context: "classic-check", app_id: -1 }],
      checks: [{ name: "classic-check", status: "completed", conclusion: "success", app: { id: 73 } }],
    });
    expect(mergeCalls(result)).toHaveLength(1);
  });

  test.each([
    ["failed", [{ name: "classic-check", status: "completed", conclusion: "failure", app: { id: 73 } }], "required check classic-check completed with failure"],
    ["missing", [], "required check classic-check is missing"],
  ] as const)("does not merge when the app_id -1 required check is %s", (_state, checks, expectedReason) => {
    const result = makeHarness({ requiredChecks: [{ context: "classic-check", app_id: -1 }], checks: [...checks] });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(stopComments(result).some((entry) => entry.body?.includes(expectedReason))).toBe(true);
  });

  test("still enforces a concrete app ID for a classic required check", () => {
    const result = makeHarness({
      requiredChecks: [{ context: "classic-check", app_id: 25 }],
      checks: [{ name: "classic-check", status: "completed", conclusion: "success", app: { id: 73 } }],
    });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(stopComments(result).some((entry) => entry.body?.includes("required check classic-check from app 25 is missing"))).toBe(true);
  });

  test("stops when the readiness-completion workflow run failed", () => {
    const result = makeHarness({ eventName: "workflow_run", workflowRunConclusion: "failure" });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(result.comments.some((comment) => comment.body.includes("Gate Readiness Reevaluate completed with failure"))).toBe(true);
  });

  test("a no-required-check branch stops without green current-head evidence", () => {
    const result = makeHarness({ requiredChecks: [], branchProtected: false, rulesAvailable: false, checks: [] });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(stopComments(result).some((entry) => entry.body?.includes("no green current-head CI/check run"))).toBe(true);
  });

  test("a no-required-check branch merges after green current-head check evidence", () => {
    const result = makeHarness({ requiredChecks: [], branchProtected: false, rulesAvailable: false });
    expect(mergeCalls(result)).toHaveLength(1);
  });

  test("a no-required-check branch does not merge when only an unrelated job is green", () => {
    const result = makeHarness({
      requiredChecks: [],
      branchProtected: false,
      rulesAvailable: false,
      checks: [{ name: "unrelated-job", status: "completed", conclusion: "success", app: { id: 1, slug: "github-actions", name: "GitHub Actions" } }],
    });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(stopComments(result).some((entry) => entry.body?.includes("no green current-head CI/check run exercises the changed paths"))).toBe(true);
  });

  test("combines legacy branch checks with checks required by branch rules", () => {
    const result = makeHarness({ requiredChecks: [{ context: "legacy-check", app_id: 1 }] });
    expect(mergeCalls(result)).toHaveLength(1);
    expect(result.log.some((entry) => entry.args.some((arg) => arg.includes("/rules/branches/main")))).toBe(true);
  });

  test.each(["HITL", "needs-human", "needs-fix", "gate:needs-human", "gate:needs-fix", "gate:blocked"])(
    "does not merge when blocking label %s is present",
    (label) => {
      const result = makeHarness({ labels: ["gate:merge-candidate", label] });
      expect(mergeCalls(result)).toHaveLength(0);
      expect(stopComments(result).some((entry) => entry.body?.includes(`blocking label ${label} is present`))).toBe(true);
    },
  );

  test("does not merge when the readiness report says the verdict is stale", () => {
    const result = makeHarness({ reportHeadSha: otherSha });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(result.comments.some((comment) => comment.body.includes(`verdict head ${otherSha} is stale`))).toBe(true);
  });

  test("does not merge for any other valid verdict state", () => {
    const result = makeHarness({ verdictState: "needs-human", labels: ["gate:needs-human"] });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(stopComments(result).some((entry) => entry.body?.includes("latest current allowlisted verdict is needs-human"))).toBe(true);
  });

  test("posts at most one stop comment per head and reason across retries", () => {
    const first = makeHarness({ verdictHeadSha: otherSha });
    expect(first.comments.filter((comment) => comment.body.includes("review-gate-auto-merge-stop:"))).toHaveLength(stopComments(first).length);
    const persisted = first.comments.filter((comment) => comment.body.includes("review-gate-auto-merge-stop:"));
    const second = makeHarness({ verdictHeadSha: otherSha });
    expect(persisted.every((comment) => second.comments.some((candidate) => candidate.body === comment.body))).toBe(true);
  });

  test("listens to verdict, CI, check completion, and readiness reevaluation rather than label events", () => {
    expect(workflow).toContain("issue_comment:");
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("workflows: [CI, Gate Labels, Gate Readiness Reevaluate]");
    expect(workflow).toContain("check_run:");
    expect(workflow).toContain("repository_dispatch:");
    expect(workflow).toContain("status:");
    expect(workflow).not.toContain("labeled");
  });
});
