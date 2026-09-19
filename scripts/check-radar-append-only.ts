import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RADAR_PATH = "RADAR.md";
const baseRef = process.argv[2];

if (!baseRef) {
  console.error("usage: bun scripts/check-radar-append-only.ts <base-ref>");
  process.exit(2);
}

function splitEntries(text: string): string[] {
  const starts = [...text.matchAll(/^## /gm)].map((match) => match.index!);

  if (starts.length === 0) {
    throw new Error(`${RADAR_PATH} contains no entries`);
  }

  return starts.map((start, index) =>
    text.slice(start, starts[index + 1] ?? text.length),
  );
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

const baseEntries = splitEntries(base);
const currentEntries = splitEntries(current);

let cursor = 0;

for (const entry of baseEntries) {
  const match = currentEntries.indexOf(entry, cursor);

  if (match === -1) {
    const heading = entry.split("\n", 1)[0] ?? "unknown entry";
    console.error(
      `${RADAR_PATH} append-only violation: existing entry changed, disappeared, or moved: ${heading}`,
    );
    process.exit(1);
  }

  cursor = match + 1;
}

console.log(
  `${RADAR_PATH} append-only check passed: preserved ${baseEntries.length} existing entries; current file has ${currentEntries.length} entries`,
);
