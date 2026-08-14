import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { REPOS } from "./gate-state";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

type Harness = {
  root: string;
  binDir: string;
  ghLog: string;
};

function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "gate-state-"));
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const ghLog = join(root, "gh.log");
  writeFileSync(ghLog, "", "utf8");
  return { root, binDir, ghLog };
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function writeGhStub(h: Harness, responses: Record<string, unknown[] | { error: string }>): void {
  const cases = Object.entries(responses)
    .map(([repo, payload]) => {
      if (Array.isArray(payload)) {
        return `  ${shQuote(repo)}) printf '%s' ${shQuote(JSON.stringify(payload))} ;;
`;
      }

      return `  ${shQuote(repo)}) printf '%s\n' ${shQuote(payload.error)} >&2
    exit 1 ;;
`;
    })
    .join("");

  writeExecutable(
    join(h.binDir, "gh"),
    `#!/bin/sh
set -eu
printf '%s\n' "$*" >> ${shQuote(h.ghLog)}
if [ "$1" != "pr" ] || [ "$2" != "list" ]; then
  printf '%s\n' "unexpected gh args: $*" >&2
  exit 64
fi
repo=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      repo="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
case "$repo" in
${cases}  *) printf '[]' ;;
esac
`,
  );
}

function runGateState(h: Harness, args: string[] = []) {
  return spawnSync("bun", ["tooling/gate-state/gate-state.ts", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${h.binDir}:${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
  });
}

function gateRows(draft: boolean): unknown[] {
  return [
    {
      number: 1,
      title: "ungated",
      headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      comments: [],
      isDraft: draft,
    },
    {
      number: 2,
      title: "current",
      headRefOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      comments: [
        {
          body: "## review-gate: needs-fix\nhead-sha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      isDraft: draft,
    },
    {
      number: 3,
      title: "stale",
      headRefOid: "cccccccccccccccccccccccccccccccccccccccc",
      comments: [
        {
          body: "## review-gate: needs-fix\nhead-sha: dddddddddddddddddddddddddddddddddddddddd\n",
          createdAt: "2026-01-02T00:00:00Z",
        },
      ],
      isDraft: draft,
    },
  ];
}

describe("tooling/gate-state/gate-state.ts", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });

  afterEach(() => {
    rmSync(harness.root, { recursive: true, force: true });
  });

  test("classifies ungated, current, and stale PRs in the default table", () => {
    const responses = Object.fromEntries(REPOS.map((repo) => [repo, gateRows(false)]));
    writeGhStub(harness, responses);

    const result = runGateState(harness);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("ungated");
    expect(result.stdout).toContain("current");
    expect(result.stdout).toContain("stale");
    expect(readFileSync(harness.ghLog, "utf8").trim().split("\n")).toEqual(
      REPOS.map((repo) => `pr list --repo ${repo} --state open --json number,title,headRefOid,comments,isDraft`),
    );
  });

  test("--json returns the same classifications", () => {
    const responses = Object.fromEntries(REPOS.map((repo) => [repo, gateRows(false)]));
    writeGhStub(harness, responses);

    const result = runGateState(harness, ["--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(
      (JSON.parse(result.stdout) as Array<{ repo: string; number: number; gateState: string }>).map(
        ({ repo, number, gateState }) => ({ repo, number, gateState }),
      ),
    ).toEqual(
      [...REPOS].sort().flatMap((repo) => [
        { repo, number: 1, gateState: "ungated" },
        { repo, number: 2, gateState: "current" },
        { repo, number: 3, gateState: "stale" },
      ]),
    );
  });

  test("--count-open excludes drafts", () => {
    const responses = Object.fromEntries(
      REPOS.map((repo) => [
        repo,
        [
          {
            number: 1,
            title: "open",
            headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            comments: [],
            isDraft: false,
          },
          {
            number: 2,
            title: "draft",
            headRefOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            comments: [
              {
                body: "## review-gate: needs-fix\nhead-sha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
                createdAt: "2026-01-01T00:00:00Z",
              },
            ],
            isDraft: true,
          },
          {
            number: 3,
            title: "open-two",
            headRefOid: "cccccccccccccccccccccccccccccccccccccccc",
            comments: [
              {
                body: "## review-gate: needs-fix\nhead-sha: dddddddddddddddddddddddddddddddddddddddd\n",
                createdAt: "2026-01-02T00:00:00Z",
              },
            ],
            isDraft: false,
          },
        ],
      ]),
    );
    writeGhStub(harness, responses);

    const result = runGateState(harness, ["--count-open"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(String(REPOS.length * 2));
  });

  test("continues when gh fails for one repo and warns on stderr", () => {
    const [failedRepo, ...rest] = REPOS;
    const responses = Object.fromEntries([
      [failedRepo, { error: "gh auth failed for repo" }],
      ...rest.map((repo) => [repo, gateRows(false)]),
    ]);
    writeGhStub(harness, responses);

    const result = runGateState(harness);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`warning: failed to load open PRs for ${failedRepo}`);
    expect(result.stdout).toContain(rest[0]);
    expect(result.stdout).not.toContain(failedRepo);
  });
});
