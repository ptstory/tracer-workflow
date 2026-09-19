import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RADAR_PATH = "RADAR.md";

export function splitEntries(text: string): string[] {
  const starts = [...text.matchAll(/^## /gm)].map((match) => match.index!);

  if (starts.length === 0) {
    throw new Error(`${RADAR_PATH} contains no entries`);
  }

  return starts.map((start, index) =>
    text
      .slice(start, starts[index + 1] ?? text.length)
      .replace(/(?:\r?\n[ \t]*)+$/u, ""),
  );
}

export function findAppendOnlyViolation(
  baseText: string,
  currentText: string,
): string | null {
  const baseEntries = splitEntries(baseText);
  const currentEntries = splitEntries(currentText);

  let cursor = 0;

  for (const entry of baseEntries) {
    const match = currentEntries.indexOf(entry, cursor);

    if (match === -1) {
      return entry.split("\n", 1)[0] ?? "unknown entry";
    }

    cursor = match + 1;
  }

  return null;
}

function main(): void {
  const baseRef = process.argv[2];

  if (!baseRef) {
    console.error("usage: bun scripts/check-radar-append-only.ts <base-ref>");
    process.exit(2);
  }

  const current = readFileSync(RADAR_PATH, "utf8");

  let base: string;
  try {
    base = execFileSync("git", ["show", `${baseRef}:${RADAR_PATH}`], {
      encoding: "utf8",
    });
  } catch {
    console.error(
      `unable to read ${RADAR_PATH} from base ref ${baseRef}; ensure the base branch was fetched`,
    );
    process.exit(2);
  }

  const violation = findAppendOnlyViolation(base, current);

  if (violation) {
    console.error(
      `${RADAR_PATH} append-only violation: existing entry changed, disappeared, or moved: ${violation}`,
    );
    process.exit(1);
  }

  console.log(
    `${RADAR_PATH} append-only check passed: preserved ${splitEntries(base).length} existing entries; current file has ${splitEntries(current).length} entries`,
  );
}

if (import.meta.main) {
  main();
}
