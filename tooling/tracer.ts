#!/usr/bin/env bun

import { resume } from "./tracer-resume/tracer-resume";

function main(argv: string[] = process.argv.slice(2)): void {
  if (argv.length === 1 && argv[0] === "--help") {
    process.stdout.write("usage: bun run tracer resume <PR URL or number>\n");
    return;
  }
  if (argv.length !== 2 || argv[0] !== "resume") {
    process.stderr.write("usage: bun run tracer resume <PR URL or number>\n");
    process.exitCode = 2;
    return;
  }
  try {
    process.stdout.write(resume(argv[1]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unable to resolve current PR state: ${message}\n`);
    process.exitCode = message.startsWith("expected a GitHub") || message === "pull request number is out of range" ? 2 : 1;
  }
}

if (import.meta.main) main();

export { main };
