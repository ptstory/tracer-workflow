import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { REPOS } from "../gate-state/gate-state";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

type Comment = { body: string; createdAt: string };

type ListPR = {
  number: number;
  title: string;
  headRefOid: string;
  comments: Comment[];
  isDraft: boolean;
};

type Harness = {
  root: string;
  binDir: string;
  ghLog: string;
  pbcopyLog: string;
};

type StubState = {
  listByRepo: Record<string, ListPR[]>;
  prViews: Record<string, { body?: string; comments?: Comment[]; error?: string }>;
  issueViews: Record<string, { text?: string; error?: string }>;
  diffs: Record<string, { text?: string; error?: string }>;
};

function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "gate-packet-"));
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const ghLog = join(root, "gh.log");
  const pbcopyLog = join(root, "pbcopy.log");
  writeFileSync(ghLog, "", "utf8");
  writeFileSync(pbcopyLog, "", "utf8");
  return { root, binDir, ghLog, pbcopyLog };
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

function emptyStubState(): StubState {
  return {
    listByRepo: Object.fromEntries(REPOS.map((repo) => [repo, []])),
    prViews: {},
    issueViews: {},
    diffs: {},
  };
}

function writeGhStub(h: Harness, state: StubState): void {
  writeExecutable(
    join(h.binDir, "gh"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const state = ${JSON.stringify(state)};
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(h.ghLog)}, args.join(" ") + "\\n");

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : "";
}

function key() {
  return getArg("--repo") + "#" + args[2];
}

if (args[0] === "pr" && args[1] === "list") {
  process.stdout.write(JSON.stringify(state.listByRepo[getArg("--repo")] ?? []));
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "view") {
  const entry = state.prViews[key()];
  if (!entry) {
    process.stderr.write("missing pr view fixture\\n");
    process.exit(1);
  }
  if (entry.error) {
    process.stderr.write(entry.error + "\\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ body: entry.body ?? "", comments: entry.comments ?? [] }));
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "view") {
  const entry = state.issueViews[key()];
  if (!entry) {
    process.stderr.write("missing issue view fixture\\n");
    process.exit(1);
  }
  if (entry.error) {
    process.stderr.write(entry.error + "\\n");
    process.exit(1);
  }
  process.stdout.write(entry.text ?? "");
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "diff") {
  const entry = state.diffs[key()];
  if (!entry) {
    process.stderr.write("missing diff fixture\\n");
    process.exit(1);
  }
  if (entry.error) {
    process.stderr.write(entry.error + "\\n");
    process.exit(1);
  }
  process.stdout.write(entry.text ?? "");
  process.exit(0);
}

process.stderr.write("unexpected gh args: " + args.join(" ") + "\\n");
process.exit(64);
`,
  );
}

function writePbcopyStub(h: Harness): void {
  writeExecutable(
    join(h.binDir, "pbcopy"),
    `#!/usr/bin/env node
const fs = require("node:fs");
let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  data += chunk;
});
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(h.pbcopyLog)}, data, "utf8");
});
`,
  );
}

function runGatePacket(h: Harness, args: string[] = []) {
  return spawnSync("bun", ["tooling/gate-packet/gate-packet.ts", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${h.binDir}:${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
  });
}

function gateComment(headSha: string, verdict = "needs-fix", at = "2026-01-01T00:00:00Z"): Comment {
  return {
    body: `## review-gate: ${verdict}\nhead-sha: ${headSha}\nreview-round: 1\nreviewed-files: 1\n`,
    createdAt: at,
  };
}

function invalidGateComment(headSha: string, verdict = "needs-fix", at = "2026-01-01T00:00:00Z"): Comment {
  return {
    body: `## review-gate: ${verdict}\nhead-sha: ${headSha}\nreviewed-files: 1\n`,
    createdAt: at,
  };
}

describe("tooling/gate-packet/gate-packet.ts", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
    writePbcopyStub(harness);
  });

  afterEach(() => {
    rmSync(harness.root, { recursive: true, force: true });
  });

  test("filters drafts and current PRs and copies the remaining packets to the clipboard by default", () => {
    const state = emptyStubState();
    const repo = REPOS[0];

    state.listByRepo[repo] = [
      {
        number: 1,
        title: "ungated",
        headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        comments: [],
        isDraft: false,
      },
      {
        number: 2,
        title: "stale",
        headRefOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        comments: [gateComment("cccccccccccccccccccccccccccccccccccccccc")],
        isDraft: false,
      },
      {
        number: 3,
        title: "current",
        headRefOid: "dddddddddddddddddddddddddddddddddddddddd",
        comments: [gateComment("dddddddddddddddddddddddddddddddddddddddd")],
        isDraft: false,
      },
      {
        number: 4,
        title: "draft",
        headRefOid: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        comments: [],
        isDraft: true,
      },
    ];

    state.prViews[`${repo}#1`] = {
      body: "Closes #11",
      comments: [],
    };
    state.prViews[`${repo}#2`] = {
      body: "Fixes https://github.com/ptstory/tracer-workflow/issues/12",
      comments: [gateComment("cccccccccccccccccccccccccccccccccccccccc", "needs-fix", "2026-01-02T00:00:00Z")],
    };
    state.issueViews[`${repo}#11`] = { text: "issue #11 — alpha\nbody:\nissue body 11" };
    state.issueViews[`${repo}#12`] = { text: "issue #12 — beta\nbody:\nissue body 12" };
    state.diffs[`${repo}#1`] = { text: "diff --git a/a.txt b/a.txt\n+one\n" };
    state.diffs[`${repo}#2`] = { text: "diff --git a/b.txt b/b.txt\n+two\n" };
    writeGhStub(harness, state);

    const result = runGatePacket(harness);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
    const copied = readFileSync(harness.pbcopyLog, "utf8");
    expect(copied).toContain("=== ptstory/core-tweaks#1 — ungated");
    expect(copied).toContain("=== ptstory/core-tweaks#2 — stale");
    expect(copied).not.toContain("current");
    expect(copied).not.toContain("draft");
    expect(copied).toContain("--- issue ---");
    expect(copied).toContain("--- prior verdict ---");
    expect(copied).toContain("--- diff ---");
  });

  test("writes the formatted packet blocks to stdout when --stdout is set", () => {
    const state = emptyStubState();
    const repo = REPOS[0];

    state.listByRepo[repo] = [
      {
        number: 7,
        title: "packet",
        headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        comments: [gateComment("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")],
        isDraft: false,
      },
    ];
    state.prViews[`${repo}#7`] = {
      body: "Resolves #77",
      comments: [gateComment("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "needs-fix", "2026-01-02T00:00:00Z")],
    };
    state.issueViews[`${repo}#77`] = { text: "issue #77 — packet\nbody:\nissue body 77" };
    state.diffs[`${repo}#7`] = { text: "diff --git a/x.txt b/x.txt\n+payload\n" };
    writeGhStub(harness, state);

    const result = runGatePacket(harness, ["--stdout"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(readFileSync(harness.pbcopyLog, "utf8")).toBe("");
    expect(result.stdout).toContain("=== ptstory/core-tweaks#7 — packet");
    expect(result.stdout).toContain("issue #77 — packet");
    expect(result.stdout).toContain("head: aaaaaaa   gate: stale");
  });

  test("renders no prior verdict when the latest marked comment is non-conforming", () => {
    const state = emptyStubState();
    const repo = REPOS[0];

    state.listByRepo[repo] = [
      {
        number: 8,
        title: "invalid verdict",
        headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        comments: [],
        isDraft: false,
      },
    ];
    state.prViews[`${repo}#8`] = {
      body: "Closes #78",
      comments: [invalidGateComment("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "needs-fix", "2026-01-02T00:00:00Z")],
    };
    state.issueViews[`${repo}#78`] = { text: "issue #78 — invalid verdict\nbody:\nissue body 78" };
    state.diffs[`${repo}#8`] = { text: "diff --git a/x.txt b/x.txt\n+payload\n" };
    writeGhStub(harness, state);

    const result = runGatePacket(harness, ["--stdout"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("=== ptstory/core-tweaks#8 — invalid verdict");
    expect(result.stdout).toContain("--- prior verdict ---\nnone");
  });

  test("truncates diffs largest first and preserves issue and verdict sections", () => {
    const state = emptyStubState();
    const repo = REPOS[0];

    state.listByRepo[repo] = [
      {
        number: 1,
        title: "big diff",
        headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        comments: [],
        isDraft: false,
      },
      {
        number: 2,
        title: "small diff",
        headRefOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        comments: [gateComment("cccccccccccccccccccccccccccccccccccccccc")],
        isDraft: false,
      },
    ];
    state.prViews[`${repo}#1`] = { body: "Closes #101", comments: [] };
    state.prViews[`${repo}#2`] = {
      body: "Closes #102",
      comments: [gateComment("cccccccccccccccccccccccccccccccccccccccc", "needs-fix", "2026-01-02T00:00:00Z")],
    };
    state.issueViews[`${repo}#101`] = { text: "issue #101 — big\nbody:\nissue body 101" };
    state.issueViews[`${repo}#102`] = { text: "issue #102 — small\nbody:\nissue body 102" };
    state.diffs[`${repo}#1`] = {
      text: [
        "diff --git a/a.txt b/a.txt",
        "@@ -1,30 +1,30 @@",
        "-one",
        "+two",
        "-three",
        "+four",
        "-five",
        "+six",
        "-seven",
        "+eight",
        "-nine",
        "+ten",
        "-eleven",
        "+twelve",
        "-thirteen",
        "+fourteen",
        "-fifteen",
        "+sixteen",
        "-seventeen",
        "+eighteen",
        "-nineteen",
        "+twenty",
        "-twenty-one",
        "+twenty-two",
        "-twenty-three",
        "+twenty-four",
        "-twenty-five",
        "+twenty-six",
        "-twenty-seven",
        "+twenty-eight",
        "-twenty-nine",
        "+thirty",
      ].join("\n"),
    };
    state.diffs[`${repo}#2`] = { text: "diff --git a/b.txt b/b.txt\n+small\n" };
    writeGhStub(harness, state);

    const result = runGatePacket(harness, ["--stdout", "--budget", "500"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("truncated");
    expect(result.stdout).toMatch(/truncated \d+ lines/);
    expect(result.stdout).toContain("issue #101 — big");
    expect(result.stdout).toContain("issue #102 — small");
    expect(result.stdout).toContain("--- prior verdict ---\nnone");
    expect(result.stdout).toContain("--- prior verdict ---\n## review-gate: needs-fix");
    expect(result.stdout.indexOf("... truncated")).toBeLessThan(result.stdout.indexOf("diff --git a/b.txt b/b.txt"));
  });

  test("lists omitted PR numbers when the budget cannot fit every selected packet", () => {
    const state = emptyStubState();
    const repo = REPOS[0];

    state.listByRepo[repo] = [
      {
        number: 9,
        title: "keep",
        headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        comments: [],
        isDraft: false,
      },
      {
        number: 10,
        title: "omit",
        headRefOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        comments: [gateComment("cccccccccccccccccccccccccccccccccccccccc")],
        isDraft: false,
      },
    ];
    state.prViews[`${repo}#9`] = { body: "Closes #109", comments: [] };
    state.prViews[`${repo}#10`] = {
      body: "Closes #110",
      comments: [gateComment("cccccccccccccccccccccccccccccccccccccccc", "needs-fix", "2026-01-02T00:00:00Z")],
    };
    state.issueViews[`${repo}#109`] = { text: "issue #109 — keep\nbody:\nissue body 109" };
    state.issueViews[`${repo}#110`] = { text: "issue #110 — omit\nbody:\nissue body 110" };
    state.diffs[`${repo}#9`] = { text: "diff --git a/k.txt b/k.txt\n+keep\n" };
    state.diffs[`${repo}#10`] = { text: "diff --git a/o.txt b/o.txt\n+omit\n" };
    writeGhStub(harness, state);

    const result = runGatePacket(harness, ["--stdout", "--budget", "260"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("=== ptstory/core-tweaks#9 — keep");
    expect(result.stdout).not.toContain("=== ptstory/core-tweaks#10 — omit");
    expect(result.stdout).toContain("omitted");
    expect(result.stdout).toContain("- 10");
  });

  test("warns and continues when gh fails for one PR", () => {
    const state = emptyStubState();
    const repo = REPOS[0];

    state.listByRepo[repo] = [
      {
        number: 21,
        title: "broken",
        headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        comments: [],
        isDraft: false,
      },
      {
        number: 22,
        title: "healthy",
        headRefOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        comments: [gateComment("cccccccccccccccccccccccccccccccccccccccc")],
        isDraft: false,
      },
    ];
    state.prViews[`${repo}#21`] = { error: "boom" };
    state.prViews[`${repo}#22`] = {
      body: "Closes #122",
      comments: [gateComment("cccccccccccccccccccccccccccccccccccccccc", "needs-fix", "2026-01-02T00:00:00Z")],
    };
    state.issueViews[`${repo}#122`] = { text: "issue #122 — healthy\nbody:\nissue body 122" };
    state.diffs[`${repo}#21`] = { text: "diff --git a/bad.txt b/bad.txt\n+bad\n" };
    state.diffs[`${repo}#22`] = { text: "diff --git a/good.txt b/good.txt\n+good\n" };
    writeGhStub(harness, state);

    const result = runGatePacket(harness, ["--stdout"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`warning: failed to load PR #21 from ${repo}`);
    expect(result.stdout).toContain("=== ptstory/core-tweaks#22 — healthy");
    expect(result.stdout).toContain("=== ptstory/core-tweaks#21 — broken");
    expect(result.stdout).toContain("--- issue ---\nnone");
  });
});
