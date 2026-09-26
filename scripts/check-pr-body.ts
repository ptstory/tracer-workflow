import { readFileSync } from "node:fs";

const sections = ["Summary", "Evidence", "Merge Danger", "Docs"] as const;

type PullRequestEvent = {
  pull_request?: { body?: string | null; head?: { sha?: string } };
};

export function validatePrBody(body: string, headSha: string): string[] {
  const errors: string[] = [];
  if (!/\b(?:Fixes|Closes|Resolves)\s+(?:[\w.-]+\/[\w.-]+)?#\d+\b/i.test(body)) {
    errors.push("missing Fixes/Closes/Resolves issue reference");
  }

  const headings = [...body.matchAll(/^## (Summary|Evidence|Merge Danger|Docs)\s*$/gm)];
  for (const section of sections) {
    if (!headings.some((heading) => heading[1] === section)) {
      errors.push(`missing ## ${section} section`);
    }
  }

  const evidence = headings.find((heading) => heading[1] === "Evidence");
  if (evidence) {
    const start = evidence.index! + evidence[0].length;
    const end = body.slice(start).search(/^## /m);
    const content = body.slice(start, end < 0 ? undefined : start + end);
    const sha = content.match(/^\s*-?\s*Head SHA:\s*([0-9a-f]{40})\s*$/im)?.[1];
    if (!sha || sha.toLowerCase() !== headSha.toLowerCase()) {
      errors.push("Evidence Head SHA does not match the current PR head SHA");
    }
  }
  return errors;
}

function main(): void {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.error("GITHUB_EVENT_PATH is required");
    process.exit(2);
  }
  let event: PullRequestEvent;
  try {
    event = JSON.parse(readFileSync(eventPath, "utf8")) as PullRequestEvent;
  } catch {
    console.error("unable to read pull request event");
    process.exit(2);
  }
  const body = event.pull_request?.body;
  const sha = event.pull_request?.head?.sha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha) || (body !== null && typeof body !== "string")) {
    console.error("pull request event is missing a valid body or head SHA");
    process.exit(2);
  }
  const errors = validatePrBody(body ?? "", sha);
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(`PR body contract passed for head ${sha}`);
}

if (import.meta.main) {
  main();
}
