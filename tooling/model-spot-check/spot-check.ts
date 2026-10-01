#!/usr/bin/env bun
/**
 * Model spot check: same tasks, same base, two model arms, graded by the merged
 * PRs' tests. See README.md in this directory and
 * docs/plans/2026-09-29-stack-and-model-plan.md section 4a.
 *
 *   bun tooling/model-spot-check/spot-check.ts order --seed <n> [--role decision|pilot]
 *   bun tooling/model-spot-check/spot-check.ts prepare <taskId> --arm A|B [--trial 1]
 *   bun tooling/model-spot-check/spot-check.ts run <taskId> --arm A|B [--trial 1] [--suite]
 *   bun tooling/model-spot-check/spot-check.ts grade <runDir> --session <crushSessionId>
 *       [--usage-before <text>] [--usage-after <text>] [--suite]
 *   bun tooling/model-spot-check/spot-check.ts report
 *
 * Requires: git, gh (authenticated, for issue text and private repo fetches), crush.
 * Runs live under ~/spot-runs unless SPOT_RUNS_ROOT is set.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  WORKER_PROMPT,
  crushrcForRun,
  easyTierDecision,
  formatCodexUsage,
  isInvalid,
  issueDocument,
  modelMatches,
  normalizeCodexUsage,
  onlyNewSession,
  runOrder,
  scanToolCalls,
  summarizeResults,
  summarizeSession,
  toolCalls,
  type Arm,
  type CodexUsageSnapshot,
  type CommandResult,
  type CrushSession,
  type Manifest,
  type RunResult,
  type Task,
} from "./lib";

const HERE = dirname(new URL(import.meta.url).pathname);
const RUNS_ROOT = process.env.SPOT_RUNS_ROOT ?? join(homedir(), "spot-runs");
// Reading these during a run invalidates it: they hold the answers.
const FORBIDDEN_PREFIXES = (process.env.SPOT_FORBIDDEN_PREFIXES ?? "~/Code").split(",");
const ALLOWED_PREFIXES = ["~/.config/crush", "~/.agents/skills", "~/.claude/skills", "~/.local/share/crush"];

type RunMeta = {
  runId: string;
  taskId: string;
  arm: Arm;
  trial: number;
  model: string;
  reasoningEffort: string;
  base: string;
  issueSha256: string;
  preparedAt: string;
  workDir: string;
  crushrcSha256?: string;
  crushCommand?: string[];
  crushExitCode?: number;
  crushSessionId?: string;
};

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(HERE, "tasks.json"), "utf8")) as Manifest;
}

function task(id: string): Task {
  const found = manifest().tasks.find((t) => t.id === id);
  if (!found) throw new Error(`unknown task ${id}; see tasks.json`);
  return found;
}

function exec(command: string[], cwd: string, input?: string): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({ cmd: command, cwd, stdin: input === undefined ? "ignore" : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe" });
  return { exitCode: result.exitCode ?? 1, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function must(command: string[], cwd: string): string {
  const result = exec(command, cwd);
  if (result.exitCode !== 0) throw new Error(`${command.join(" ")} failed in ${cwd}:\n${result.stderr || result.stdout}`);
  return result.stdout;
}

function shell(line: string, cwd: string): void {
  must(["sh", "-c", line], cwd);
}

// Fetch one ref into a throwaway repo outside the runs root, so nothing a worker
// can reach holds more than the base snapshot.
function fetchRef(repo: string, ref: string): string {
  const dir = mkdtempSync(join(tmpdir(), "spot-src-"));
  must(["git", "init", "-q"], dir);
  must(["git", "fetch", "-q", "--depth=1", `https://github.com/${repo}.git`, ref], dir);
  return dir;
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function runCommand(command: string[], cwd: string): CommandResult {
  const result = exec(command, cwd);
  const output = `${result.stdout}\n${result.stderr}`.trim().split("\n");
  return { command, exitCode: result.exitCode, tail: output.slice(-25).join("\n") };
}

type SessionListEntry = { id?: unknown };

const CODEX_USAGE_PROBE = String.raw`
import json
import subprocess

p = subprocess.Popen(
    ["codex", "app-server", "--stdio"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    bufsize=1,
)

def send(obj):
    p.stdin.write(json.dumps(obj) + "\n")
    p.stdin.flush()

def recv(request_id):
    while True:
        line = p.stdout.readline()
        if not line:
            err = p.stderr.read()
            raise RuntimeError("codex app-server exited: " + err)
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("id") == request_id:
            if "error" in msg:
                raise RuntimeError(str(msg["error"]))
            return msg["result"]

try:
    send({
        "method": "initialize",
        "id": 1,
        "params": {
            "clientInfo": {"name": "model-spot-check", "version": "1.0.0"},
            "capabilities": {"experimentalApi": True},
        },
    })
    recv(1)
    send({"method": "initialized"})
    send({"method": "account/read", "id": 2, "params": {}})
    account = recv(2)
    send({"method": "account/rateLimits/read", "id": 3})
    limits = recv(3)
    print(json.dumps({"account": account, "limits": limits}))
finally:
    p.terminate()
`;

function captureCodexUsage(cwd: string): CodexUsageSnapshot {
  const raw = must(["python3", "-c", CODEX_USAGE_PROBE], cwd).trim();
  const envelope = JSON.parse(raw) as { account?: unknown; limits?: unknown };
  const snapshot = normalizeCodexUsage(envelope.account, envelope.limits);
  if (snapshot.accountType !== "chatgpt") throw new Error(`Codex is not using a ChatGPT account (type=${snapshot.accountType ?? "unknown"})`);
  if (snapshot.ordinaryUsageAllowed === false) throw new Error("Codex reports ordinary usage is not allowed for this account");
  return snapshot;
}

function assertPinnedCodexAccount(snapshot: CodexUsageSnapshot): void {
  const identity = snapshot.accountId ?? snapshot.accountEmail?.toLowerCase();
  if (!identity) throw new Error("Codex account snapshot has neither account ID nor email");
  const fingerprint = createHash("sha256").update(identity).digest("hex");
  const path = join(RUNS_ROOT, "codex-account.sha256");
  if (!existsSync(path)) {
    mkdirSync(RUNS_ROOT, { recursive: true });
    writeFileSync(path, `${fingerprint}\n`);
    console.log("Pinned verified Codex account fingerprint for this experiment.");
    return;
  }
  const expected = readFileSync(path, "utf8").trim();
  if (expected !== fingerprint) {
    throw new Error("Codex account changed from the account pinned for this experiment");
  }
}

function sessionIds(cwd: string): string[] {
  const raw = must(["env", "CRUSH_DISABLE_PROVIDER_AUTO_UPDATE=1", "crush", "session", "list", "--json"], cwd);
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("crush session list --json did not return an array");
  return parsed.map((entry, i) => {
    const id = (entry as SessionListEntry)?.id;
    if (typeof id !== "string" || !id) throw new Error(`crush session list entry ${i} has no string id`);
    return id;
  });
}

function runCrush(command: string[], cwd: string): number {
  const result = Bun.spawnSync({ cmd: command, cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return result.exitCode ?? 1;
}

function order(args: string[]): void {
  const seed = Number(arg(args, "--seed"));
  if (!Number.isInteger(seed)) throw new Error("--seed <integer> is required; write it down before the first run");
  const role = arg(args, "--role") ?? "decision";
  const tasks = manifest().tasks.filter((t) => t.role === role);
  const slots = runOrder(tasks, seed, { easy: Number(arg(args, "--easy-trials") ?? 2), hard: Number(arg(args, "--hard-trials") ?? 1) });
  slots.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}  ${s.taskId}  arm ${s.arm}  trial ${s.trial}`));
}

function prepareRun(args: string[], printInstructions: boolean): string {
  const t = task(args[0] ?? "");
  const arm = (arg(args, "--arm") ?? "") as Arm;
  if (arm !== "A" && arm !== "B") throw new Error("--arm A|B is required");
  const trial = Number(arg(args, "--trial") ?? 1);
  const { model, reasoningEffort } = manifest().arms[arm];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `${t.id}-${arm}-t${trial}-${stamp}`;
  const runDir = join(RUNS_ROOT, runId);
  const workDir = join(runDir, "work");
  mkdirSync(workDir, { recursive: true });

  const src = fetchRef(t.repo, t.base);
  try {
    shell(`git archive ${t.base} | tar -x -C '${workDir}'`, src);
  } finally {
    rmSync(src, { recursive: true, force: true });
  }

  const issue = JSON.parse(must(["gh", "issue", "view", String(t.issue), "--repo", t.repo, "--json", "title,body"], workDir)) as { title: string; body: string };
  const notesPath = join(HERE, "interfaces", `${t.id}.md`);
  const notes = existsSync(notesPath) ? readFileSync(notesPath, "utf8") : null;
  writeFileSync(join(workDir, "ISSUE.md"), issueDocument(issue.title, issue.body, notes));

  must(["git", "init", "-q"], workDir);
  writeFileSync(join(workDir, ".git", "info", "exclude"), ".venv/\nnode_modules/\n.crushrc\n", { flag: "a" });
  must(["git", "add", "-A"], workDir);
  must(["git", "-c", "user.name=spot-check", "-c", "user.email=spot-check@localhost", "commit", "-q", "-m", `spot-check base ${t.base}`], workDir);
  for (const line of t.setup) shell(line, workDir);

  const runCrushrc = crushrcForRun(model, reasoningEffort);
  writeFileSync(join(workDir, ".crushrc"), runCrushrc);

  const meta: RunMeta = {
    runId, taskId: t.id, arm, trial, model, reasoningEffort, base: t.base,
    issueSha256: createHash("sha256").update(issue.body).digest("hex"),
    preparedAt: new Date().toISOString(), workDir,
    crushrcSha256: createHash("sha256").update(runCrushrc).digest("hex"),
  };
  writeFileSync(join(runDir, "run.json"), `${JSON.stringify(meta, null, 2)}\n`);

  if (printInstructions) {
    console.log(`Prepared ${runDir}

Run-local .crushrc pins:
  large: ${model} (${reasoningEffort})
  small: ${model} (${reasoningEffort})
  provider auto-update: disabled

For the automated path, run:
  bun ${join(HERE, "spot-check.ts")} run ${t.id} --arm ${arm} --trial ${trial}

For an interactive fallback:
  1. Note the Codex usage readout.
  2. cd '${workDir}' && CRUSH_DISABLE_PROVIDER_AUTO_UPDATE=1 crush
  3. Paste this as the only prompt:

${WORKER_PROMPT}

Then note usage again, identify the new session with 'crush session list --json',
and invoke grade manually.
`);
  }
  return runDir;
}

function prepare(args: string[]): void {
  prepareRun(args, true);
}

function run(args: string[]): void {
  const runDir = prepareRun(args, false);
  const metaPath = join(runDir, "run.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as RunMeta;

  console.log(`Prepared ${runDir}`);
  console.log(`Arm ${meta.arm}: ${meta.model} (${meta.reasoningEffort}); run-local .crushrc generated.`);
  const usageBeforeSnapshot = captureCodexUsage(meta.workDir);
  assertPinnedCodexAccount(usageBeforeSnapshot);
  writeFileSync(join(runDir, "usage-before.json"), `${JSON.stringify(usageBeforeSnapshot, null, 2)}\n`);
  const usageBefore = formatCodexUsage(usageBeforeSnapshot);
  console.log(`Usage before: ${usageBefore}`);
  const before = sessionIds(meta.workDir);

  console.log("\nLaunching Crush. No picker or prompt paste is required.\n");
  const crushCommand = [
    "env",
    "CRUSH_DISABLE_PROVIDER_AUTO_UPDATE=1",
    "crush",
    "run",
    "--model",
    meta.model,
    "--small-model",
    meta.model,
    "--reasoning-effort",
    meta.reasoningEffort,
    WORKER_PROMPT,
  ];
  meta.crushCommand = crushCommand;
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  const exitCode = runCrush(crushCommand, meta.workDir);

  const usageAfterSnapshot = captureCodexUsage(meta.workDir);
  assertPinnedCodexAccount(usageAfterSnapshot);
  writeFileSync(join(runDir, "usage-after.json"), `${JSON.stringify(usageAfterSnapshot, null, 2)}\n`);
  const usageAfter = formatCodexUsage(usageAfterSnapshot);
  console.log(`Usage after:  ${usageAfter}`);
  const after = sessionIds(meta.workDir);
  const sessionId = onlyNewSession(before, after);

  meta.crushExitCode = exitCode;
  meta.crushSessionId = sessionId;
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  if (exitCode !== 0) {
    console.log(`Crush exited with code ${exitCode}; grading the produced work/session anyway.`);
  }
  console.log(`New session: ${sessionId}`);

  const gradeArgs = [
    runDir,
    "--session", sessionId,
    "--usage-before", usageBefore,
    "--usage-after", usageAfter,
  ];
  if (args.includes("--suite")) gradeArgs.push("--suite");
  grade(gradeArgs);
}

function grade(args: string[]): void {
  const runDir = resolve(args[0] ?? "");
  const meta = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as RunMeta;
  const t = task(meta.taskId);
  const workDir = meta.workDir;
  const sessionId = arg(args, "--session");
  const runConfigPath = join(workDir, ".crushrc");
  const runConfigFinding = (() => {
    if (!meta.crushrcSha256) return [];
    if (!existsSync(runConfigPath)) {
      return [{ severity: "violation" as const, rule: "run-config-changed", tool: "harness", excerpt: ".crushrc is missing" }];
    }
    const actual = createHash("sha256").update(readFileSync(runConfigPath)).digest("hex");
    return actual === meta.crushrcSha256
      ? []
      : [{ severity: "violation" as const, rule: "run-config-changed", tool: "harness", excerpt: `.crushrc SHA-256 ${actual}, expected ${meta.crushrcSha256}` }];
  })();

  let session: CrushSession | null = null;
  if (sessionId) {
    const raw = must(["crush", "session", "show", sessionId, "--json"], workDir);
    writeFileSync(join(runDir, "session.json"), raw);
    session = JSON.parse(raw) as CrushSession;
  }
  const metrics = session ? summarizeSession(session) : null;
  const findings = [
    ...runConfigFinding,
    ...(session
      ? scanToolCalls(toolCalls(session), { workDir, home: homedir(), allowedPrefixes: ALLOWED_PREFIXES, forbiddenPrefixes: FORBIDDEN_PREFIXES })
      : []),
  ];
  const matches = metrics ? modelMatches(meta.model, metrics.models) : null;

  // Keep the worker's result as a commit, then overlay hidden tests on top of it.
  must(["git", "add", "-A"], workDir);
  must(["git", "-c", "user.name=spot-check", "-c", "user.email=spot-check@localhost", "commit", "-q", "--allow-empty", "-m", "spot-check: worker result"], workDir);
  const baseCommit = must(["git", "rev-list", "--max-parents=0", "HEAD"], workDir).trim();
  writeFileSync(join(runDir, "worker.diff"), must(["git", "diff", baseCommit, "HEAD", "--", ".", ":(exclude)ISSUE.md"], workDir));

  const head = fetchRef(t.repo, `pull/${t.pr}/head`);
  const base = t.regression ? fetchRef(t.repo, t.base) : null;
  let result: RunResult;
  try {
    for (const file of t.graded.files) {
      mkdirSync(dirname(join(workDir, file)), { recursive: true });
      writeFileSync(join(workDir, file), must(["git", "show", `FETCH_HEAD:${file}`], head));
    }
    if (t.regression && base) {
      for (const file of t.regression.restoreFromBase) {
        writeFileSync(join(workDir, file), must(["git", "show", `FETCH_HEAD:${file}`], base));
      }
    }
    for (const line of t.gradeSetup ?? []) shell(line, workDir);

    const graded = runCommand(t.graded.command, workDir);
    result = {
      runId: meta.runId, taskId: t.id, role: t.role, tier: t.tier, arm: meta.arm, trial: meta.trial,
      expectedModel: meta.model, gradedAt: new Date().toISOString(),
      graded, passed: graded.exitCode === 0,
      reviewDerived: t.reviewDerived ? runCommand(t.reviewDerived.command, workDir) : null,
      regression: t.regression ? runCommand(t.regression.command, workDir) : null,
      suite: args.includes("--suite") && t.suite ? runCommand(t.suite, workDir) : null,
      session: metrics, modelMatches: matches, findings,
      invalid: isInvalid(findings, matches),
      usage: { before: arg(args, "--usage-before") ?? null, after: arg(args, "--usage-after") ?? null },
    };
  } finally {
    rmSync(head, { recursive: true, force: true });
    if (base) rmSync(base, { recursive: true, force: true });
    // Drop the hidden tests again; the worker result commit stays.
    exec(["git", "reset", "-q", "--hard", "HEAD"], workDir);
    exec(["git", "clean", "-qfd"], workDir);
  }

  writeFileSync(join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  appendFileSync(join(RUNS_ROOT, "results.jsonl"), `${JSON.stringify(result)}\n`);
  console.log(`${t.id} arm ${meta.arm}: ${result.passed ? "PASS" : "FAIL"}${result.invalid ? " (INVALID)" : ""}`);
  if (matches === false) console.log(`  model mismatch: expected ${meta.model}, session used ${metrics?.models.join(", ")}`);
  for (const f of findings) console.log(`  ${f.severity}: ${f.rule} via ${f.tool}: ${f.excerpt}`);
  if (!session) console.log("  no --session given: model, tool calls and leakage were not checked");
}

function report(): void {
  const path = join(RUNS_ROOT, "results.jsonl");
  if (!existsSync(path)) throw new Error(`no results yet at ${path}`);
  const results = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as RunResult);
  const rows = summarizeResults(results);
  console.log("task                         tier  arm  valid runs  passed  invalid");
  for (const r of rows) console.log(`${r.taskId.padEnd(28)} ${r.tier.padEnd(5)} ${r.arm.padEnd(4)} ${String(r.runs).padEnd(11)} ${String(r.passed).padEnd(7)} ${r.invalid}`);
  const d = easyTierDecision(rows);
  console.log(`\nEasy/medium tier: Luna ${d.lunaPassed} passed, Sol ${d.solPassed} passed -> ${d.lunaDefault ? "Luna stays default" : "Sol becomes default"} (rule fixed in the plan, section 4a)`);
}

const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, (args: string[]) => void> = { order, prepare, run, grade, report: () => report() };
if (!command || !commands[command]) {
  console.error("usage: spot-check.ts order|prepare|run|grade|report (see the header of this file)");
  process.exit(2);
}
commands[command](rest);
