import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "../..");
const headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const otherSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const prUrl = "https://github.com/acme/project/pull/17";

type Harness = { root: string; binDir: string; ghLog: string };

type VerdictName = "needs-fix" | "needs-human" | "blocked" | "merge-candidate";

function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "tracer-resume-"));
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const ghLog = join(root, "gh.log");
  writeFileSync(ghLog, "", "utf8");
  return { root, binDir, ghLog };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function writeGhStub(harness: Harness, payload: unknown, failure?: string): void {
  const response = failure
    ? `printf '%s\\n' ${shellQuote(failure)} >&2\nexit 1`
    : `printf '%s' ${shellQuote(JSON.stringify(payload))}`;
  writeFileSync(join(harness.binDir, "gh"), `#!/bin/sh\nset -eu\nprintf '%s\\n' "$*" >> ${shellQuote(harness.ghLog)}\nif [ "$1" != "pr" ] || [ "$2" != "view" ]; then\n  printf '%s\\n' "unexpected GitHub command: $*" >&2\n  exit 64\nfi\n${response}\n`, "utf8");
  chmodSync(join(harness.binDir, "gh"), 0o755);
}

function prPayload(verdict?: VerdictName, verdictSha = headSha, malformedMarker = false): unknown {
  const comments = verdict ? [
    {
      body: `## review-gate: ${verdict}\nhead-sha: ${verdictSha}\nreview-round: 0\nreviewed-files: ${verdict === "needs-fix" ? 1 : 0}\nblocking-set: ${verdict === "needs-fix" || verdict === "blocked" ? "src/api.ts" : ""}\nnext-action: ${verdict === "needs-fix" ? `from-pr-review ${prUrl}` : verdict === "merge-candidate" ? "gh pr ready 17" : verdict === "needs-human" ? "gh pr view 17 --web" : "gh pr checks 17"}\n`,
      author: { login: "reviewer" },
      createdAt: "2026-10-01T00:00:00Z",
    },
    ...(malformedMarker ? [{
      body: `## review-gate: ${verdict}\nhead-sha: invalid\nreview-round: 0\nreviewed-files: 1\nblocking-set: src/api.ts\nnext-action: from-pr-review ${prUrl}\n`,
      author: { login: "reviewer" },
      createdAt: "2026-10-02T00:00:00Z",
    }] : []),
  ] : [];
  return {
    number: 17,
    title: "Example pull request",
    headRefOid: headSha,
    comments,
    isDraft: false,
  };
}

function runResume(harness: Harness, input: string) {
  return spawnSync("bun", ["tooling/tracer.ts", "resume", input], {
    cwd: repoRoot,
    env: {
      ...process.env,
      TRACER_REVIEWER_LOGINS: "reviewer",
      PATH: `${harness.binDir}:${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
  });
}

describe("tracer resume", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });

  afterEach(() => {
    rmSync(harness.root, { recursive: true, force: true });
  });

  test("routes a PR without a valid verdict to Review Gate with one invocation", () => {
    writeGhStub(harness, prPayload());

    const result = runResume(harness, prUrl);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`PR: ${prUrl}`);
    expect(result.stdout).toContain(`Head SHA: ${headSha}`);
    expect(result.stdout).toContain("State: review-gate");
    expect(result.stdout).toContain(`Invocation: @review-gate ${prUrl}`);
    expect(result.stdout.match(/^Invocation:/gm)).toHaveLength(1);
    expect(readFileSync(harness.ghLog, "utf8").trim()).toBe("pr view 17 --repo acme/project --json number,title,headRefOid,comments,isDraft");
  });

  test("routes current needs-fix to from-pr-review", () => {
    writeGhStub(harness, prPayload("needs-fix"));

    const result = runResume(harness, prUrl);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("State: from-pr-review");
    expect(result.stdout).toContain(`Invocation: from-pr-review ${prUrl}`);
    expect(result.stdout.match(/^Invocation:/gm)).toHaveLength(1);
  });

  test("retains current needs-fix when a newer trusted marker is malformed", () => {
    writeGhStub(harness, prPayload("needs-fix", headSha, true));

    const result = runResume(harness, prUrl);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("State: from-pr-review");
    expect(result.stdout).toContain(`Invocation: from-pr-review ${prUrl}`);
    expect(result.stdout).not.toContain("State: review-gate");
  });

  test("retains current needs-human when a newer trusted marker is malformed", () => {
    writeGhStub(harness, prPayload("needs-human", headSha, true));

    const result = runResume(harness, prUrl);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("State: needs-human");
    expect(result.stdout).not.toContain("Invocation:");
    expect(result.stdout).not.toContain("State: review-gate");
  });

  test("routes stale verdicts to Review Gate without using stale action", () => {
    writeGhStub(harness, prPayload("needs-fix", otherSha));

    const result = runResume(harness, prUrl);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("State: review-gate");
    expect(result.stdout).toContain("Reason: stale-verdict");
    expect(result.stdout).toContain(`Invocation: @review-gate ${prUrl}`);
    expect(result.stdout).not.toContain("from-pr-review");
  });

  test("routes malformed verdicts to Review Gate", () => {
    const payload = prPayload("needs-fix") as { comments: Array<{ body: string; author: { login: string }; createdAt: string }> };
    payload.comments[0].body = payload.comments[0].body.replace("review-round: 0", "review-round: invalid");
    writeGhStub(harness, payload);

    const result = runResume(harness, prUrl);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("State: review-gate");
    expect(result.stdout).toContain("Reason: malformed-verdict");
    expect(result.stdout).toContain(`Invocation: @review-gate ${prUrl}`);
  });

  test("returns explicit current needs-human, blocked, and merge-candidate states without an invocation", () => {
    for (const verdict of ["needs-human", "blocked", "merge-candidate"] as const) {
      writeGhStub(harness, prPayload(verdict));

      const result = runResume(harness, "17");

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`State: ${verdict === "merge-candidate" ? "human-checks" : verdict}`);
      if (verdict === "merge-candidate") expect(result.stdout).toContain("Reason: check current-head checks and human/AFK authorization");
      expect(result.stdout).not.toContain("Invocation:");
      expect(readFileSync(harness.ghLog, "utf8").trim()).toBe("pr view 17 --repo ptstory/tracer-workflow --json number,title,headRefOid,comments,isDraft");
      writeFileSync(harness.ghLog, "", "utf8");
    }
  });

  test("fails closed before GitHub access when reviewer configuration is missing", () => {
    writeGhStub(harness, prPayload());
    const result = spawnSync("bun", ["tooling/tracer.ts", "resume", "17"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        TRACER_REVIEWER_LOGINS: "",
        PATH: `${harness.binDir}:${process.env.PATH ?? ""}`,
      },
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("TRACER_REVIEWER_LOGINS must contain at least one reviewer login");
    expect(readFileSync(harness.ghLog, "utf8")).toBe("");
  });

  test("fails clearly when GitHub access is unavailable", () => {
    writeGhStub(harness, null, "permission denied");

    const result = runResume(harness, "17");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unable to resolve current PR state");
    expect(result.stderr).toContain("permission denied");
  });

  test("rejects malformed input before any GitHub call", () => {
    writeGhStub(harness, prPayload());

    const result = runResume(harness, "https://github.com/acme/project/issues/17");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("expected a GitHub pull request URL or a pull request number");
    expect(readFileSync(harness.ghLog, "utf8")).toBe("");
  });

  test("rejects unsupported command forms", () => {
    const result = spawnSync("bun", ["tooling/tracer.ts", "resume", "17", "extra"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: bun run tracer resume <PR URL or number>");
  });
});
