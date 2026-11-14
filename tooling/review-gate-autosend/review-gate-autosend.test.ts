import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const scriptPath = "tooling/review-gate-autosend/review-gate-autosend.ts";
const pullRequestUrl = "https://github.com/ptstory/tracer-workflow/pull/12";
const currentHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const oldHead = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

type CommentFixture = { author: { login: string }; body: string; createdAt: string };

type Harness = { root: string; bin: string; openLog: string };

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function makeHarness(comments: CommentFixture[], headRefOid = currentHead): Harness {
  const root = mkdtempSync(join(tmpdir(), "review-gate-autosend-"));
  const bin = join(root, "bin");
  const openLog = join(root, "open.log");
  const payload = JSON.stringify({ number: 12, headRefOid, comments });
  const ghPath = join(bin, "gh");
  const openPath = join(bin, "open");
  const ghStub = `#!/bin/sh\nprintf '%s\\n' ${shellQuote(payload)}\n`;
  const openStub = `#!/bin/sh\nprintf '%s\\n' "$@" >> ${shellQuote(openLog)}\n`;
  requireDirectory(bin);
  writeExecutable(ghPath, ghStub);
  writeExecutable(openPath, openStub);
  return { root, bin, openLog };
}

function requireDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

function runAutosend(harness: Harness) {
  return spawnSync("bun", [scriptPath, pullRequestUrl], {
    cwd: repoRoot,
    env: {
      ...process.env,
      TRACER_REVIEWER_LOGINS: "reviewer",
      PATH: `${harness.bin}:${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
  });
}

function verdictComment(headSha: string, verdict = "merge-candidate"): CommentFixture {
  const nextAction = verdict === "merge-candidate" ? "gh pr ready 12" : "gh pr view 12 --web";
  return {
    author: { login: "reviewer" },
    body: `## review-gate: ${verdict}\nhead-sha: ${headSha}\nreview-round: 0\nreviewed-files: 1\nblocking-set:\nnext-action: ${nextAction}\n`,
    createdAt: "2026-10-01T00:00:00Z",
  };
}

describe("tooling/review-gate-autosend", () => {
  test("does not launch for a current-head verdict and prints its next action", () => {
    const harness = makeHarness([verdictComment(currentHead)]);
    try {
      const result = runAutosend(harness);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("PR URL: https://github.com/ptstory/tracer-workflow/pull/12");
      expect(result.stdout).toContain("Current Review Gate verdict: merge-candidate");
      expect(result.stdout).toContain("Next action: gh pr ready 12");
      expect(existsSync(harness.openLog) ? readFileSync(harness.openLog, "utf8") : "").toBe("");
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  });

  test("launches for a verdict on an older head", () => {
    const harness = makeHarness([verdictComment(oldHead)]);
    try {
      const result = runAutosend(harness);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("PR URL: https://github.com/ptstory/tracer-workflow/pull/12");
      expect(readFileSync(harness.openLog, "utf8")).toBe(`-g\nhttps://chatgpt.com/?autosend=1&q=${encodeURIComponent(`@review-gate ${pullRequestUrl}`)}\n`);
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  });

  test("launches when no verdict exists", () => {
    const harness = makeHarness([]);
    try {
      const result = runAutosend(harness);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("PR URL: https://github.com/ptstory/tracer-workflow/pull/12");
      expect(readFileSync(harness.openLog, "utf8")).toBe(`-g\nhttps://chatgpt.com/?autosend=1&q=${encodeURIComponent(`@review-gate ${pullRequestUrl}`)}\n`);
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  });
});
