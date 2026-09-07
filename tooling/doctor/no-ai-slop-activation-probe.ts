import { mkdtempSync, mkdirSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

type ActivationProbeOptions = {
  repoRoot?: string;
  opencodeBinary?: string;
};

type ActivationProbeTranscript = {
  command: string[];
  cwd: string;
  home: string;
  runtimeSkillPath: string;
  repoSkillPath: string;
  opencodeBinary: string;
  exitCode: number;
  entryCount: number;
  discovered?: {
    name: string;
    location: string;
    contentMatches: boolean;
  };
  error?: string;
};

type ActivationProbeResult = {
  ok: boolean;
  transcript: ActivationProbeTranscript;
};

function getRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function renderSkillContent(raw: string): string {
  const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1] : raw;
}

export function runNoAiSlopActivationProbe(options: ActivationProbeOptions = {}): ActivationProbeResult {
  const repoRoot = options.repoRoot ?? getRepoRoot();
  const opencodeBinary = options.opencodeBinary ?? "opencode";
  const repoSkillPath = join(repoRoot, "skills/no-ai-slop/SKILL.md");
  const home = mkdtempSync(join(tmpdir(), "tracer-doctor-home-"));
  const runtimeSkillDir = join(home, ".agents/skills/no-ai-slop");
  const runtimeSkillPath = join(home, ".agents/skills/no-ai-slop/SKILL.md");
  const command = ["opencode", "debug", "skill", "--pure"];
  let exitCode = -1;
  let stdout = "";
  let stderr = "";

  try {
    mkdirSync(join(home, ".agents/skills"), { recursive: true });
    symlinkSync(join(repoRoot, "skills/no-ai-slop"), runtimeSkillDir, "dir");

    const result = spawnSync(opencodeBinary, ["debug", "skill", "--pure"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });

    exitCode = result.status ?? -1;
    stdout = result.stdout ?? "";
    stderr = result.stderr ?? "";

    const transcript: ActivationProbeTranscript = {
      command,
      cwd: repoRoot,
      home,
      runtimeSkillPath,
      repoSkillPath,
      opencodeBinary,
      exitCode,
      entryCount: 0,
    };

    if (exitCode !== 0) {
      transcript.error = stderr.trim() || `opencode exited with ${exitCode}`;
      return { ok: false, transcript };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      transcript.error = `invalid JSON: ${(error as Error).message}`;
      return { ok: false, transcript };
    }

    if (!Array.isArray(parsed)) {
      transcript.error = "expected top-level JSON array";
      return { ok: false, transcript };
    }

    transcript.entryCount = parsed.length;
    const discovered = parsed.find((entry) => Boolean(entry) && typeof entry === "object" && (entry as { name?: unknown }).name === "no-ai-slop") as
      | { name?: unknown; location?: unknown; content?: unknown }
      | undefined;

    if (!discovered) {
      transcript.error = "no-ai-slop skill was not discovered";
      return { ok: false, transcript };
    }

    const expectedContent = renderSkillContent(readFileSync(repoSkillPath, "utf8"));
    const discoveredLocation = typeof discovered.location === "string" ? discovered.location : "";
    const discoveredContent = typeof discovered.content === "string" ? discovered.content : "";
    const contentMatches = discoveredContent === expectedContent;

    transcript.discovered = {
      name: "no-ai-slop",
      location: discoveredLocation,
      contentMatches,
    };

    if (discoveredLocation !== runtimeSkillPath) {
      transcript.error = `expected discovery from ${runtimeSkillPath}`;
      return { ok: false, transcript };
    }

    if (!contentMatches) {
      transcript.error = "discovered skill content did not match repo-owned source";
      return { ok: false, transcript };
    }

    return { ok: true, transcript };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function parseCliArgs(argv: string[]): ActivationProbeOptions {
  const options: ActivationProbeOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo-root") {
      options.repoRoot = argv[++index];
      continue;
    }
    if (arg === "--opencode-bin") {
      options.opencodeBinary = argv[++index];
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function runCli(argv: string[]): number {
  const result = runNoAiSlopActivationProbe(parseCliArgs(argv));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = runCli(Bun.argv.slice(2));
}
