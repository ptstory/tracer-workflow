import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { formatCheckDiagnostic } from "./check-diagnostic";

const RADAR_PATH = "RADAR.md";

export function splitEntries(text: string): string[] {
  const starts = [...text.matchAll(/^## /gm)].map((match) => match.index!);

  if (starts.length === 0) {
    throw new Error(formatCheckDiagnostic(`at least one entry in ${RADAR_PATH}`, "no entries", "restore an entry heading before validating append-only history"));
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
    console.error(formatCheckDiagnostic("a base-ref argument", "missing", "run bun scripts/check-radar-append-only.ts <base-ref>"));
    process.exitCode = 2;
    return;
  }

  const current = readFileSync(RADAR_PATH, "utf8");

  let base: string;
  try {
    base = execFileSync("git", ["show", `${baseRef}:${RADAR_PATH}`], {
      encoding: "utf8",
    });
  } catch {
    console.error(
      formatCheckDiagnostic(`${RADAR_PATH} to be readable from base ref ${baseRef}`, "base file unavailable", "fetch the base branch and retry"),
    );
    process.exitCode = 2;
    return;
  }

  const violation = findAppendOnlyViolation(base, current);

  if (violation) {
    console.error(
      formatCheckDiagnostic(`${RADAR_PATH} to preserve all existing entries unchanged and in order`, violation, "restore the changed, missing, or moved entry and append new entries without modifying existing ones"),
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `${RADAR_PATH} append-only check passed: preserved ${splitEntries(base).length} existing entries; current file has ${splitEntries(current).length} entries`,
  );
}

if (import.meta.main) {
  main();
}
