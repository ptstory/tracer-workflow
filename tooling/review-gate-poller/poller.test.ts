import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultGitHeadSha = "9999999999999999999999999999999999999999";

type Harness = {
  root: string;
  binDir: string;
  statePath: string;
  workdir: string;
  ghLog: string;
  opencodeLog: string;
};

function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "review-gate-poller-"));
  const binDir = join(root, "bin");
  const workdir = join(root, "workdir");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(root, "gh.log"), "", "utf8");
  writeFileSync(join(root, "opencode.log"), "", "utf8");

  return {
    root,
    binDir,
    workdir,
    statePath: join(root, "state.json"),
    ghLog: join(root, "gh.log"),
    opencodeLog: join(root, "opencode.log"),
  };
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

function writeGhStub(h: Harness, listJson: string, viewJson: string): void {
  writeExecutable(
    join(h.binDir, "gh"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const [cmd, subcmd] = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(h.ghLog)}, process.argv.slice(2).join(" ") + "\\n");
if (cmd === "pr" && subcmd === "list") {
  process.stdout.write(${JSON.stringify(listJson)});
} else if (cmd === "pr" && subcmd === "view") {
  process.stdout.write(${JSON.stringify(viewJson)});
} else {
  process.stderr.write("unexpected gh args: " + process.argv.slice(2).join(" ") + "\\n");
  process.exit(64);
}
`,
  );
}

function writeOpencodeStub(
  h: Harness,
  body: string,
  exitCode = 0,
): void {
  writeExecutable(
    join(h.binDir, "opencode"),
    `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "${h.opencodeLog}"
${body}
exit ${exitCode}
`,
  );
}

function writeGitStub(h: Harness, headSha: string): void {
  writeExecutable(
    join(h.binDir, "git"),
    `#!/bin/sh
set -eu
case "$1 $2" in
  "rev-parse HEAD")
    printf '%s\n' '${headSha}'
    ;;
  *)
    printf 'unexpected git args: %s\n' "$*" >&2
    exit 64
    ;;
esac
`,
  );
}

function runPoller(h: Harness, extraEnv: Record<string, string> = {}) {
  return spawnSync("bun", ["tooling/review-gate-poller/poller.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${h.binDir}:${process.env.PATH ?? ""}`,
      RG_REPO: "acme/repo",
      RG_STATE_PATH: h.statePath,
      RG_WORKDIR: h.workdir,
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

function readState(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeInProgressState(h: Harness, prNumber: number, headSha: string, lastAttemptAt: number): void {
  writeFileSync(
    h.statePath,
    JSON.stringify(
      {
        [prNumber]: {
          headSha,
          status: "in-progress",
          attempts: 1,
          createdAt: lastAttemptAt,
          lastAttemptAt,
          updatedAt: lastAttemptAt,
          nextRetryAt: null,
          exitCode: null,
          error: null,
          resultingSha: null,
        },
      },
      null,
      2,
    ),
  );
}

describe("tooling/review-gate-poller/poller.ts", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
    writeGitStub(harness, defaultGitHeadSha);
  });

  afterEach(() => {
    rmSync(harness.root, { recursive: true, force: true });
  });

  test("writes durable in-progress state before launching opencode", () => {
    writeGhStub(
      harness,
      JSON.stringify([{ number: 11, headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]),
      JSON.stringify({
        comments: [
          {
            author: { login: "review-bot" },
            body: "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    writeOpencodeStub(
      harness,
      `if ! [ -f "${harness.statePath}" ]; then
  printf 'state missing before opencode\n' >&2
  exit 91
fi
state=$(cat "${harness.statePath}")
case "$state" in
  *aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa* ) : ;;
  *)
    printf 'state did not contain the active head before opencode: %s\n' "$state" >&2
    exit 92
    ;;
esac
case "$state" in
  *in-progress* ) : ;;
  *)
    printf 'state was not marked in-progress before opencode: %s\n' "$state" >&2
    exit 93
    ;;
esac
`,
      0,
    );

    const result = runPoller(harness);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(readState(harness.statePath)).toEqual({
      11: expect.objectContaining({
        headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "completed",
        attempts: 1,
        resultingSha: defaultGitHeadSha,
      }),
    });
  });

  test("persists state even when opencode exits nonzero", () => {
    writeGhStub(
      harness,
      JSON.stringify([{ number: 12, headRefOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }]),
      JSON.stringify({
        comments: [
          {
            author: { login: "review-bot" },
            body: "## review-gate: needs-fix\nhead-sha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    writeOpencodeStub(harness, `printf 'boom\n' >&2`, 37);

    const result = runPoller(harness);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(readState(harness.statePath)).toEqual({
      12: expect.objectContaining({
        headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        status: "failed",
        attempts: 1,
        exitCode: 37,
        error: "boom",
      }),
    });
  });

  test("sanitizes noisy stderr to a single line", () => {
    writeGhStub(
      harness,
      JSON.stringify([{ number: 16, headRefOid: "ffffffffffffffffffffffffffffffffffffffff" }]),
      JSON.stringify({
        comments: [
          {
            author: { login: "review-bot" },
            body: "## review-gate: needs-fix\nhead-sha: ffffffffffffffffffffffffffffffffffffffff\n",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    writeOpencodeStub(harness, `printf 'boom\nstack trace\nmore noise\n' >&2`, 37);

    const result = runPoller(harness);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(readState(harness.statePath)).toEqual({
      16: expect.objectContaining({
        status: "failed",
        exitCode: 37,
        error: "boom",
      }),
    });
    const stored = readState(harness.statePath) as Record<string, { error: string }>;
    expect(stored["16"].error).not.toContain("\n");
  });

  test("marks a successful fix pass as completed and stores the resulting git sha", () => {
    writeGhStub(
      harness,
      JSON.stringify([{ number: 17, headRefOid: "1111111111111111111111111111111111111111" }]),
      JSON.stringify({
        comments: [
          {
            author: { login: "review-bot" },
            body: "## review-gate: needs-fix\nhead-sha: 1111111111111111111111111111111111111111\n",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    writeGitStub(harness, "2222222222222222222222222222222222222222");
    writeOpencodeStub(harness, `:`, 0);

    const result = runPoller(harness);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(readState(harness.statePath)).toEqual({
      17: expect.objectContaining({
        headSha: "1111111111111111111111111111111111111111",
        status: "completed",
        attempts: 1,
        resultingSha: "2222222222222222222222222222222222222222",
      }),
    });
  });

  test("migrates legacy string state to completed without relaunching", () => {
    writeGhStub(
      harness,
      JSON.stringify([{ number: 18, headRefOid: "3333333333333333333333333333333333333333" }]),
      JSON.stringify({
        comments: [
          {
            author: { login: "review-bot" },
            body: "## review-gate: needs-fix\nhead-sha: 3333333333333333333333333333333333333333\n",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    writeFileSync(harness.statePath, JSON.stringify({ 18: "3333333333333333333333333333333333333333" }, null, 2));
    writeOpencodeStub(harness, `printf 'unexpected relaunch\n' >&2`, 91);

    const result = runPoller(harness);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(readFileSync(harness.opencodeLog, "utf8")).toBe("");
    expect(readState(harness.statePath)).toEqual({
      18: expect.objectContaining({
        headSha: "3333333333333333333333333333333333333333",
        status: "completed",
        attempts: 1,
      }),
    });
  });

  test("uses the stale in-progress timeout instead of the retry backoff", () => {
    writeGhStub(
      harness,
      JSON.stringify([{ number: 19, headRefOid: "4444444444444444444444444444444444444444" }]),
      JSON.stringify({
        comments: [
          {
            author: { login: "review-bot" },
            body: "## review-gate: needs-fix\nhead-sha: 4444444444444444444444444444444444444444\n",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    writeFileSync(
      harness.statePath,
      JSON.stringify(
        {
          19: {
            headSha: "4444444444444444444444444444444444444444",
            status: "in-progress",
            attempts: 1,
            createdAt: 1,
            lastAttemptAt: 1,
            updatedAt: 1,
            nextRetryAt: null,
            exitCode: null,
            error: null,
            resultingSha: null,
          },
        },
        null,
        2,
      ),
    );

    writeGitStub(harness, "5555555555555555555555555555555555555555");
    writeOpencodeStub(harness, `:`, 0);

    const backoffOnlyResult = runPoller(harness, { RG_NOW_MS: "60001" });

    expect(backoffOnlyResult.status).toBe(0);
    expect(backoffOnlyResult.stderr).toBe("");
    expect(readFileSync(harness.opencodeLog, "utf8")).toBe("");
    expect(readState(harness.statePath)).toEqual({
      19: expect.objectContaining({
        status: "in-progress",
        attempts: 1,
      }),
    });

    rmSync(harness.opencodeLog, { force: true });
    writeFileSync(harness.opencodeLog, "", "utf8");
    writeFileSync(
      harness.statePath,
      JSON.stringify(
        {
          19: {
            headSha: "4444444444444444444444444444444444444444",
            status: "in-progress",
            attempts: 1,
            createdAt: 1,
            lastAttemptAt: 1,
            updatedAt: 1,
            nextRetryAt: null,
            exitCode: null,
            error: null,
            resultingSha: null,
          },
        },
        null,
        2,
      ),
    );

    const staleResult = runPoller(harness, {
      RG_NOW_MS: "1800001",
      RG_STALE_IN_PROGRESS_TIMEOUT_MS: "1800000",
    });

    expect(staleResult.status).toBe(0);
    expect(staleResult.stderr).toBe("");
    expect(readFileSync(harness.opencodeLog, "utf8")).not.toBe("");
    expect(readState(harness.statePath)).toEqual({
      19: expect.objectContaining({
        status: "completed",
        attempts: 2,
        resultingSha: "5555555555555555555555555555555555555555",
      }),
    });
  });

  test.each([0, 299999])(
    "falls back to the default stale timeout when the override is below minimum (%i)",
    (overrideMs) => {
      writeGhStub(
        harness,
        JSON.stringify([{ number: 22, headRefOid: "8888888888888888888888888888888888888888" }]),
        JSON.stringify({
          comments: [
            {
              author: { login: "review-bot" },
              body: "## review-gate: needs-fix\nhead-sha: 8888888888888888888888888888888888888888\n",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        }),
      );

      writeInProgressState(
        harness,
        22,
        "8888888888888888888888888888888888888888",
        1,
      );
      writeOpencodeStub(harness, `printf 'unexpected relaunch\n' >&2`, 91);

      const result = runPoller(harness, {
        RG_NOW_MS: "300000",
        RG_STALE_IN_PROGRESS_TIMEOUT_MS: String(overrideMs),
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(readFileSync(harness.opencodeLog, "utf8")).toBe("");
      expect(readState(harness.statePath)).toEqual({
        22: expect.objectContaining({
          headSha: "8888888888888888888888888888888888888888",
          status: "in-progress",
          attempts: 1,
        }),
      });
    },
  );

  test("falls back to the default stale timeout when the override is above maximum", () => {
    writeGhStub(
      harness,
      JSON.stringify([{ number: 23, headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]),
      JSON.stringify({
        comments: [
          {
            author: { login: "review-bot" },
            body: "## review-gate: needs-fix\nhead-sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    writeInProgressState(harness, 23, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 1);
    writeGitStub(harness, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    writeOpencodeStub(harness, `:`, 0);

    const result = runPoller(harness, {
      RG_NOW_MS: "1800001",
      RG_STALE_IN_PROGRESS_TIMEOUT_MS: "86400001",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(readFileSync(harness.opencodeLog, "utf8")).not.toBe("");
    expect(readState(harness.statePath)).toEqual({
      23: expect.objectContaining({
        headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "completed",
        attempts: 2,
        resultingSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    });
  });

  test("honors a valid in-range stale timeout override at the minimum boundary", () => {
    writeGhStub(
      harness,
      JSON.stringify([{ number: 24, headRefOid: "cccccccccccccccccccccccccccccccccccccccc" }]),
      JSON.stringify({
        comments: [
          {
            author: { login: "review-bot" },
            body: "## review-gate: needs-fix\nhead-sha: cccccccccccccccccccccccccccccccccccccccc\n",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    writeInProgressState(harness, 24, "cccccccccccccccccccccccccccccccccccccccc", 1);
    writeGitStub(harness, "dddddddddddddddddddddddddddddddddddddddd");
    writeOpencodeStub(harness, `:`, 0);

    const result = runPoller(harness, {
      RG_NOW_MS: "300001",
      RG_STALE_IN_PROGRESS_TIMEOUT_MS: "300000",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(readFileSync(harness.opencodeLog, "utf8")).not.toBe("");
    expect(readState(harness.statePath)).toEqual({
      24: expect.objectContaining({
        headSha: "cccccccccccccccccccccccccccccccccccccccc",
        status: "completed",
        attempts: 2,
        resultingSha: "dddddddddddddddddddddddddddddddddddddddd",
      }),
    });
  });

  test("escalates an in-progress record already at max attempts without relaunching", () => {
    writeGhStub(
      harness,
      JSON.stringify([{ number: 20, headRefOid: "6666666666666666666666666666666666666666" }]),
      JSON.stringify({
        comments: [
          {
            author: { login: "review-bot" },
            body: "## review-gate: needs-fix\nhead-sha: 6666666666666666666666666666666666666666\n",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    writeFileSync(
      harness.statePath,
      JSON.stringify(
        {
          20: {
            headSha: "6666666666666666666666666666666666666666",
            status: "in-progress",
            attempts: 5,
            lastAttemptAt: 1,
          },
        },
        null,
        2,
      ),
    );

    writeOpencodeStub(harness, `:`, 0);

    const result = runPoller(harness, { RG_NOW_MS: "2" });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(readFileSync(harness.opencodeLog, "utf8")).toBe("");
    expect(readState(harness.statePath)).toEqual({
      20: expect.objectContaining({
        headSha: "6666666666666666666666666666666666666666",
        status: "escalated",
        attempts: 5,
      }),
    });
  });

  test("escalates on the fifth failed attempt and will not relaunch", () => {
    writeGhStub(
      harness,
      JSON.stringify([{ number: 21, headRefOid: "7777777777777777777777777777777777777777" }]),
      JSON.stringify({
        comments: [
          {
            author: { login: "review-bot" },
            body: "## review-gate: needs-fix\nhead-sha: 7777777777777777777777777777777777777777\n",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    writeFileSync(
      harness.statePath,
      JSON.stringify(
        {
          21: {
            headSha: "7777777777777777777777777777777777777777",
            status: "failed",
            attempts: 4,
            nextRetryAt: 1,
          },
        },
        null,
        2,
      ),
    );

    writeOpencodeStub(harness, `printf 'attempt 5 failed\n' >&2`, 37);

    const firstRun = runPoller(harness, { RG_NOW_MS: "2" });

    expect(firstRun.status).toBe(0);
    expect(firstRun.stderr).toBe("");
    expect(readFileSync(harness.opencodeLog, "utf8")).not.toBe("");
    expect(readState(harness.statePath)).toEqual({
      21: expect.objectContaining({
        headSha: "7777777777777777777777777777777777777777",
        status: "escalated",
        attempts: 5,
        exitCode: 37,
        error: "attempt 5 failed",
      }),
    });

    rmSync(harness.opencodeLog, { force: true });
    writeFileSync(harness.opencodeLog, "", "utf8");

    const secondRun = runPoller(harness, { RG_NOW_MS: "3" });

    expect(secondRun.status).toBe(0);
    expect(secondRun.stderr).toBe("");
    expect(readFileSync(harness.opencodeLog, "utf8")).toBe("");
    expect(readState(harness.statePath)).toEqual({
      21: expect.objectContaining({
        headSha: "7777777777777777777777777777777777777777",
        status: "escalated",
        attempts: 5,
      }),
    });
  });

  test("treats a new head SHA as a fresh record", () => {
    writeGhStub(
      harness,
      JSON.stringify([{ number: 15, headRefOid: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" }]),
      JSON.stringify({
        comments: [
          {
            author: { login: "review-bot" },
            body: "## review-gate: needs-fix\nhead-sha: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\n",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    writeFileSync(
      harness.statePath,
      JSON.stringify(
        {
          15: {
            headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            status: "failed",
            attempts: 5,
            nextRetryAt: 1,
          },
        },
        null,
        2,
      ),
    );

    writeOpencodeStub(
      harness,
      `if ! [ -f "${harness.statePath}" ]; then
  printf 'state missing for fresh record\n' >&2
  exit 94
fi
`,
      0,
    );

    const result = runPoller(harness, { RG_NOW_MS: "2" });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(readFileSync(harness.opencodeLog, "utf8")).not.toBe("");
    expect(readState(harness.statePath)).toEqual({
      15: expect.objectContaining({
        headSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        status: "completed",
        attempts: 1,
        resultingSha: defaultGitHeadSha,
      }),
    });
  });
});
