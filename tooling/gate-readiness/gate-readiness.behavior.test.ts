import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = join(repoRoot, ".github/workflows/gate-readiness.yml");
const workflow = readFileSync(workflowPath, "utf8");

type Harness = {
  root: string;
  binDir: string;
  ghLog: string;
  commentLog: string;
  eventPath: string;
  scriptPath: string;
};

type WorkflowFixture = {
  eventName: "pull_request" | "workflow_call";
  eventPayload?: unknown;
  prNumber: number;
  pullJson?: unknown;
  commentsJson: unknown[];
  checkRunsJson: unknown[];
  statusesJson: unknown[];
  blockPulls?: boolean;
};

function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "gate-readiness-"));
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const ghLog = join(root, "gh.log");
  const commentLog = join(root, "comment.log");
  const eventPath = join(root, "event.json");
  const scriptPath = join(root, "workflow.sh");
  writeFileSync(ghLog, "", "utf8");
  writeFileSync(commentLog, "", "utf8");
  writeFileSync(eventPath, "{}", "utf8");
  writeFileSync(scriptPath, "", "utf8");
  chmodSync(scriptPath, 0o755);
  return { root, binDir, ghLog, commentLog, eventPath, scriptPath };
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

function extractRunScript(): string {
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

function writeGhStub(harness: Harness, fixture: WorkflowFixture): void {
  const ghScript = `#!/usr/bin/env node
const fs = require("node:fs");

const logPath = ${JSON.stringify(harness.ghLog)};
const commentPath = ${JSON.stringify(harness.commentLog)};
const fixture = ${JSON.stringify({
    blockPulls: fixture.blockPulls ?? false,
    pullJson: fixture.pullJson ?? null,
    commentsJson: fixture.commentsJson,
    checkRunsJson: fixture.checkRunsJson,
    statusesJson: fixture.statusesJson,
  })};

const argv = process.argv.slice(2);
const endpoint = argv.find((arg) => arg.startsWith("repos/")) ?? "";
let body = "";
let method = "GET";
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "-X" && argv[i + 1]) method = argv[i + 1];
  if (argv[i].startsWith("body=")) body = argv[i].slice(5);
}
fs.appendFileSync(logPath, JSON.stringify({ argv, endpoint, method }) + "\\n");

if (body && (endpoint.includes("/issues/") || endpoint.includes("/labels"))) {
  fs.appendFileSync(commentPath, body + "\\n---\\n");
}

if (endpoint.includes("/pulls/")) {
  if (fixture.blockPulls) {
    process.stderr.write("GET /pulls/98 blocked\\n");
    process.exit(42);
  }
  process.stdout.write(JSON.stringify(fixture.pullJson ?? {}));
  process.exit(0);
}

if (endpoint.includes("/issues/") && endpoint.includes("/comments") && method === "GET") {
  process.stdout.write(JSON.stringify(fixture.commentsJson));
  process.exit(0);
}

if (endpoint.includes("/commits/") && endpoint.includes("/check-runs")) {
  process.stdout.write(JSON.stringify({ check_runs: fixture.checkRunsJson }));
  process.exit(0);
}

if (endpoint.includes("/commits/") && endpoint.includes("/statuses")) {
  process.stdout.write(JSON.stringify(fixture.statusesJson));
  process.exit(0);
}

process.exit(0);
`;
  writeExecutable(join(harness.binDir, "gh"), ghScript);
}

function runWorkflow(fixture: WorkflowFixture) {
  const harness = makeHarness();
  if (fixture.eventPayload !== undefined) {
    writeFileSync(harness.eventPath, JSON.stringify(fixture.eventPayload, null, 2), "utf8");
  }
  writeGhStub(harness, fixture);
  writeFileSync(harness.scriptPath, extractRunScript(), "utf8");

  const result = spawnSync("bash", [harness.scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${harness.binDir}:${process.env.PATH ?? ""}`,
      GH_TOKEN: "token",
      GITHUB_EVENT_NAME: fixture.eventName,
      GITHUB_EVENT_PATH: harness.eventPath,
      GITHUB_TOKEN: "token",
      REPOSITORY: "acme/repo",
      PR_NUMBER: String(fixture.prNumber),
      INPUT_PR_NUMBER: String(fixture.prNumber),
    },
    encoding: "utf8",
  });

  const ghLog = readFileSync(harness.ghLog, "utf8");
  const commentLog = readFileSync(harness.commentLog, "utf8");
  rmSync(harness.root, { recursive: true, force: true });
  return { result, ghLog, commentLog };
}

const currentReviewGateComment = {
  body: "## review-gate: merge-candidate\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nreview-round: 1\nreviewed-files: 2\n",
  created_at: "2026-01-01T00:00:00Z",
};

describe(".github/workflows/gate-readiness.yml behavior", () => {
  test("pull_request uses event payload data and never touches the pulls endpoint", () => {
    const { result, ghLog, commentLog } = runWorkflow({
      eventName: "pull_request",
      eventPayload: {
        pull_request: {
          number: 98,
          head: { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          body: "Fixes #97",
          labels: [{ name: "gate:ready" }],
        },
      },
      prNumber: 98,
      blockPulls: true,
      commentsJson: [],
      checkRunsJson: [],
      statusesJson: [],
    });

    expect(result.status, result.stderr).toBe(0);
    expect(ghLog).not.toContain("/pulls/98");
    expect(commentLog).toContain("- PR metadata source: pull_request event payload");
    expect(commentLog).toContain("- auth path: GH_TOKEN -> secrets.GITHUB_TOKEN");
  });

  test("workflow_call still uses the PR endpoint when no event payload is available", () => {
    const { result, ghLog } = runWorkflow({
      eventName: "workflow_call",
      prNumber: 98,
      pullJson: {
        head: { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        body: "Fixes #97",
        labels: [{ name: "gate:ready" }],
      },
      commentsJson: [],
      checkRunsJson: [],
      statusesJson: [],
    });

    expect(result.status, result.stderr).toBe(0);
    expect(ghLog).toContain("/pulls/98");
  });

  test("a superseded failed rerun cannot override a newer success", () => {
    const { result, commentLog } = runWorkflow({
      eventName: "pull_request",
      eventPayload: {
        pull_request: {
          number: 98,
          head: { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          body: "Fixes #97",
          labels: [],
        },
      },
      prNumber: 98,
      commentsJson: [currentReviewGateComment],
      checkRunsJson: [
        {
          id: 1,
          name: "build",
          app: { slug: "github-actions" },
          status: "completed",
          conclusion: "failure",
          run_started_at: "2026-01-05T00:00:00Z",
          started_at: "2026-01-05T00:00:00Z",
          completed_at: "2026-01-07T00:00:00Z",
        },
        {
          id: 2,
          name: "build",
          app: { slug: "github-actions" },
          status: "completed",
          conclusion: "success",
          run_started_at: "2026-01-06T00:00:00Z",
          started_at: "2026-01-06T00:00:00Z",
          completed_at: "2026-01-06T00:05:00Z",
        },
        {
          id: 3,
          name: "gate-readiness",
          app: { slug: "github-actions" },
          status: "completed",
          conclusion: "failure",
          run_started_at: "2026-01-06T01:00:00Z",
          started_at: "2026-01-06T01:00:00Z",
          completed_at: "2026-01-06T01:01:00Z",
        },
      ],
      statusesJson: [
        {
          context: "ci",
          state: "success",
          created_at: "2026-01-06T00:06:00Z",
        },
      ],
    });

    expect(result.status, result.stderr).toBe(0);
    expect(commentLog).toContain("- readiness: true");
    expect(commentLog).not.toContain("ready: false");
  });

  test("same-name check runs from distinct apps stay separate", () => {
    const { result, commentLog } = runWorkflow({
      eventName: "pull_request",
      eventPayload: {
        pull_request: {
          number: 98,
          head: { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
          body: "Fixes #97",
          labels: [],
        },
      },
      prNumber: 98,
      commentsJson: [
        {
          body: "## review-gate: merge-candidate\nhead-sha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\nreview-round: 1\nreviewed-files: 2\n",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
      checkRunsJson: [
        {
          id: 11,
          name: "build",
          app: { slug: "actions/first" },
          status: "completed",
          conclusion: "failure",
          run_started_at: "2026-01-04T00:00:00Z",
          started_at: "2026-01-04T00:00:00Z",
          completed_at: "2026-01-04T00:02:00Z",
        },
        {
          id: 12,
          name: "build",
          app: { slug: "actions/second" },
          status: "completed",
          conclusion: "success",
          run_started_at: "2026-01-05T00:00:00Z",
          started_at: "2026-01-05T00:00:00Z",
          completed_at: "2026-01-05T00:01:00Z",
        },
        {
          id: 13,
          name: "gate-readiness",
          app: { slug: "github-actions" },
          status: "completed",
          conclusion: "failure",
          run_started_at: "2026-01-06T01:00:00Z",
          started_at: "2026-01-06T01:00:00Z",
          completed_at: "2026-01-06T01:01:00Z",
        },
      ],
      statusesJson: [
        {
          context: "ci",
          state: "success",
          created_at: "2026-01-05T00:03:00Z",
        },
      ],
    });

    expect(result.status, result.stderr).toBe(0);
    expect(commentLog).toContain("- readiness: false");
  });
});
