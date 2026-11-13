import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = join(repoRoot, ".github/workflows/review-gate-auto-merge.yml");
const workflow = readFileSync(workflowPath, "utf8");
const headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const otherSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

type CheckRun = { name: string; status: string; conclusion: string | null; app: { id: number } };
type Fixture = {
  eventName?: "issue_comment" | "workflow_run" | "check_run";
  verdictAuthor?: string;
  verdictState?: string;
  verdictHeadSha?: string;
  labels?: string[];
  draft?: boolean;
  checks?: CheckRun[];
  statusContexts?: { context: string; state: string }[];
  initialComments?: { user: { login: string }; body: string; created_at: string; updated_at?: string }[];
  reviewerLogins?: string;
  eventAuthor?: string;
  requiredChecks?: { context: string; app_id: number }[];
  pullRequestOpen?: boolean;
};

type HarnessResult = {
  status: number;
  stdout: string;
  stderr: string;
  log: { command: string; args: string[]; body?: string }[];
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
  const checkRuns = fixture.checks ?? [{ name: "required-check", status: "completed", conclusion: "success", app: { id: 1 } }];
  const verdict = `## review-gate: ${fixture.verdictState ?? "merge-candidate"}\nhead-sha: ${fixture.verdictHeadSha ?? headSha}\nreview-round: 0\nreviewed-files: 1\nblocking-set:\nnext-action: gh pr merge 98 --squash --match-head-commit ${headSha}\n`;
  const comments = fixture.initialComments ?? [{
    user: { login: "github-actions[bot]" },
    body: `<!-- gate-readiness:bot -->\n## gate-readiness\n\n- PR: #98\n- head-sha: ${headSha}\n- review gate state: ${fixture.verdictHeadSha && fixture.verdictHeadSha !== headSha ? "stale" : "current"}\n- review gate verdict: ${fixture.verdictState ?? "merge-candidate"}\n- latest marker parse: valid\n- latest valid verdict: ${fixture.verdictState ?? "merge-candidate"} (head-sha: ${fixture.verdictHeadSha ?? headSha}, review-round: 0, reviewed-files: 1)\n- readiness: true\n`,
    created_at: "2026-11-13T12:00:01Z",
    updated_at: "2026-11-13T12:00:01Z",
  }, {
    user: { login: fixture.verdictAuthor ?? "reviewer" },
    body: verdict,
    created_at: "2026-11-13T12:00:00Z",
  }];
  const eventName = fixture.eventName ?? "issue_comment";
  const event = eventName === "issue_comment"
    ? {
        issue: { number: 98, pull_request: { url: "https://api.github.com/repos/acme/repo/pulls/98" } },
        comment: {
          user: { login: fixture.eventAuthor ?? fixture.verdictAuthor ?? "reviewer" },
          body: `## review-gate: ${fixture.verdictState ?? "merge-candidate"}\nhead-sha: ${fixture.verdictHeadSha ?? headSha}`,
          created_at: "2026-11-13T12:00:00Z",
        },
      }
    : eventName === "workflow_run"
      ? {
          workflow_run: {
            event: "pull_request",
            name: "CI",
            head_sha: headSha,
            updated_at: "2026-11-13T12:00:02Z",
            pull_requests: [{ number: 98 }],
          },
        }
      : {
          check_run: {
            head_sha: headSha,
            completed_at: "2026-11-13T12:00:02Z",
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
      labels: (fixture.labels ?? ["gate:merge-candidate"]).map((name) => ({ name })),
      merged: false,
      merge_commit_sha: null as string | null,
    },
    checks: checkRuns,
    statuses: fixture.statusContexts ?? [],
    requiredChecks: fixture.requiredChecks ?? [{ context: "required-check", app_id: 1 }],
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
let method = "GET";
for (let i = 0; i < args.length - 1; i += 1) if (args[i] === "-X") method = args[i + 1];
const bodyArg = args.find((arg) => arg.startsWith("body="));
const entry = { command, args, ...(bodyArg ? { body: bodyArg.slice(5) } : {}) };
fs.appendFileSync(logPath, JSON.stringify(entry) + "\\n");
if (command === "pr" && args[1] === "ready") {
  data.pr.draft = false;
  fs.writeFileSync(fixturePath, JSON.stringify(data));
  process.exit(0);
}
if (command === "pr" && args[1] === "merge") {
  data.pr.merged = true;
  data.pr.state = "closed";
  data.pr.merge_commit_sha = "cccccccccccccccccccccccccccccccccccccccc";
  fs.writeFileSync(fixturePath, JSON.stringify(data));
  process.exit(0);
}
if (endpoint.includes("/pulls/")) {
  process.stdout.write(JSON.stringify(data.pr));
} else if (endpoint.includes("/issues/") && endpoint.includes("/comments") && method === "GET") {
  process.stdout.write(JSON.stringify(data.comments));
} else if (endpoint.includes("/issues/") && endpoint.includes("/comments") && method === "POST") {
  const commentBody = bodyArg ? bodyArg.slice(5) : "";
  data.comments.push({ user: { login: "github-actions[bot]" }, body: commentBody, created_at: "2026-11-13T12:01:00Z" });
  fs.writeFileSync(fixturePath, JSON.stringify(data));
  process.stdout.write("{}\\n");
} else if (endpoint.includes("/required_status_checks")) {
  process.stdout.write(JSON.stringify({ checks: data.requiredChecks, contexts: [] }));
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
      GH_TOKEN: "token",
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
  test("merges a current allowlisted merge-candidate only after required checks pass", () => {
    const result = makeHarness({});
    expect(result.status, `${result.stderr}\n${result.stdout}\n${JSON.stringify(result.log)}`).toBe(0);
    expect(mergeCalls(result), result.stdout).toHaveLength(1);
    expect(mergeCalls(result)[0].args).toContain("--squash");
    expect(mergeCalls(result)[0].args).toContain("--delete-branch");
    expect(mergeCalls(result)[0].args).toContain("--match-head-commit");
    expect(mergeCalls(result)[0].args).toContain(headSha);
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

  test("re-evaluates after a PR check workflow completes", () => {
    const result = makeHarness({ eventName: "check_run" });
    expect(result.status, `${result.stderr}\n${result.stdout}\n${JSON.stringify(result.log)}`).toBe(0);
    expect(mergeCalls(result)).toHaveLength(1);
  });

  test("does not merge a stale verdict and names the mismatch", () => {
    const result = makeHarness({ verdictHeadSha: otherSha });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(stopComments(result).some((entry) => entry.body?.includes(`verdict head ${otherSha} is stale`))).toBe(true);
  });

  test("does not merge when the verdict author is not allowlisted", () => {
    const result = makeHarness({ verdictAuthor: "attacker", eventAuthor: "attacker" });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(result.comments.some((comment) => comment.body.includes("verdict author attacker is not allowlisted")), result.stdout).toBe(true);
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

  test.each(["HITL", "needs-human", "needs-fix", "gate:needs-human", "gate:needs-fix", "gate:blocked"])(
    "does not merge when blocking label %s is present",
    (label) => {
      const result = makeHarness({ labels: ["gate:merge-candidate", label] });
      expect(mergeCalls(result)).toHaveLength(0);
      expect(stopComments(result).some((entry) => entry.body?.includes(`blocking label ${label} is present`))).toBe(true);
    },
  );

  test("does not merge for any other valid verdict state", () => {
    const result = makeHarness({ verdictState: "needs-human", labels: ["gate:needs-human"] });
    expect(mergeCalls(result)).toHaveLength(0);
    expect(stopComments(result).some((entry) => entry.body?.includes("latest current allowlisted verdict is needs-human"))).toBe(true);
  });

  test("posts at most one stop comment per head and reason across retries", () => {
    const first = makeHarness({ verdictHeadSha: otherSha });
    const persistedStops = first.comments.filter((comment) => comment.body.includes("review-gate-auto-merge-stop:"));
    expect(persistedStops).toHaveLength(stopComments(first).length);
    const second = makeHarness({ verdictHeadSha: otherSha, initialComments: first.comments });
    expect(stopComments(second)).toHaveLength(0);
  });

  test("uses the reviewer comment and CI completion as triggers, not a label event", () => {
    expect(workflow).toContain("issue_comment:");
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("workflows: [CI, Gate Labels, Gate Readiness Reevaluate]");
    expect(workflow).toContain("check_run:");
    expect(workflow).toContain("status:");
    expect(workflow).not.toContain("labeled");
  });
});
