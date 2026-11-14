import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const scriptPath = "tooling/review-gate-autosend/review-gate-autosend.ts";
const userscriptPath = join(repoRoot, "tooling/review-gate-autosend/review-gate-autosend.user.js");
const userscriptSource = readFileSync(userscriptPath, "utf8");
const pullRequestUrl = "https://github.com/ptstory/tracer-workflow/pull/12";
const currentHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const oldHead = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

type CommentFixture = { author: { login: string }; body: string; createdAt: string };

type Harness = { root: string; bin: string; openLog: string; targetRoot: string };

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function makeHarness(comments: CommentFixture[], headRefOid = currentHead): Harness {
  const root = mkdtempSync(join(tmpdir(), "review-gate-autosend-"));
  const bin = join(root, "bin");
  const openLog = join(root, "open.log");
  const targetRoot = join(root, "foreign-repo");
  const skillsDirectory = join(root, ".agents/skills");
  const payload = JSON.stringify({ number: 12, headRefOid, comments });
  const ghPath = join(bin, "gh");
  const openPath = join(bin, "open");
  const ghStub = `#!/bin/sh\nprintf '%s\\n' ${shellQuote(payload)}\n`;
  const openStub = `#!/bin/sh\nprintf '%s\\n' "$@" >> ${shellQuote(openLog)}\n`;
  requireDirectory(bin);
  requireDirectory(targetRoot);
  requireDirectory(skillsDirectory);
  symlinkSync(join(repoRoot, "skills/from-issue"), join(skillsDirectory, "from-issue"), "dir");
  symlinkSync(join(repoRoot, "skills/from-pr-review"), join(skillsDirectory, "from-pr-review"), "dir");
  writeExecutable(ghPath, ghStub);
  writeExecutable(openPath, openStub);
  return { root, bin, openLog, targetRoot };
}

function requireDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

function runAutosend(harness: Harness, skill = "from-issue") {
  return spawnSync("sh", [
    "-c",
    'skill_dir="$(cd "$HOME/.agents/skills/$1" && pwd -P)" && bun "$skill_dir/../../tooling/review-gate-autosend/review-gate-autosend.ts" "$2"',
    "review-gate-autosend",
    skill,
    pullRequestUrl,
  ], {
    cwd: harness.targetRoot,
    env: {
      ...process.env,
      HOME: harness.root,
      TRACER_REVIEWER_LOGINS: "reviewer",
      PATH: `${harness.bin}:${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
  });
}

function makeUserscriptHarness(composerText: string) {
  let now = 0;
  let sendCount = 0;
  const timers: Array<{ callback: () => void; active: boolean }> = [];
  const session = new Map<string, string>();
  const composer = { value: composerText, innerText: "" };
  const button = { disabled: false, click: () => { sendCount += 1; } };
  const location = { href: "https://chatgpt.com/", search: "" };
  const context = {
    console: { info: () => {}, warn: () => {} },
    URLSearchParams,
    location,
    sessionStorage: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => { session.set(key, value); },
    },
    document: { querySelector: (selector: string) => selector.includes("button") ? button : composer },
    setInterval: (callback: () => void) => {
      const timer = { callback, active: true };
      timers.push(timer);
      return timer;
    },
    clearInterval: (timer: { active: boolean }) => { timer.active = false; },
    Date: { now: () => now },
  };
  return {
    composer,
    get sendCount() { return sendCount; },
    run(search: string) {
      location.search = search;
      runInNewContext(userscriptSource, context);
    },
    tick(milliseconds: number) {
      now += milliseconds;
      timers.filter((timer) => timer.active).forEach((timer) => timer.callback());
    },
  };
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

  test("resolves the helper from the from-pr-review skill in a foreign repository", () => {
    const harness = makeHarness([]);
    try {
      const result = runAutosend(harness, "from-pr-review");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("PR URL: https://github.com/ptstory/tracer-workflow/pull/12");
      expect(readFileSync(harness.openLog, "utf8")).toBe(`-g\nhttps://chatgpt.com/?autosend=1&q=${encodeURIComponent(`@review-gate ${pullRequestUrl}`)}\n`);
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  });

  test("only sends the exact expected prompt after it settles", () => {
    const harness = makeUserscriptHarness(`@review-gate ${pullRequestUrl}`);
    harness.run(`?autosend=1&q=${encodeURIComponent(`@review-gate ${pullRequestUrl}`)}`);
    harness.tick(250);
    harness.tick(1500);
    expect(harness.sendCount).toBe(1);
  });

  test.each(["different draft", `@review-gate ${pullRequestUrl} extra`, "@review-gate"]) (
    "does not send mismatched composer text: %s",
    (composerText) => {
      const harness = makeUserscriptHarness(composerText);
      harness.run(`?autosend=1&q=${encodeURIComponent(`@review-gate ${pullRequestUrl}`)}`);
      harness.tick(250);
      harness.tick(1500);
      harness.tick(250);
      expect(harness.sendCount).toBe(0);
    },
  );

  test("sends at most once per tab across distinct prompts", () => {
    const harness = makeUserscriptHarness(`@review-gate ${pullRequestUrl}`);
    harness.run(`?autosend=1&q=${encodeURIComponent(`@review-gate ${pullRequestUrl}`)}`);
    harness.tick(250);
    harness.tick(1500);
    expect(harness.sendCount).toBe(1);
    const otherUrl = "https://github.com/ptstory/tracer-workflow/pull/13";
    harness.composer.value = `@review-gate ${otherUrl}`;
    harness.run(`?autosend=1&q=${encodeURIComponent(`@review-gate ${otherUrl}`)}`);
    expect(harness.sendCount).toBe(1);
  });
});
