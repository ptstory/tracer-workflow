import { readFileSync } from "node:fs";

const sections = ["Summary", "Evidence", "Merge Danger", "Docs"] as const;

type PullRequestEvent = {
  repository?: { full_name?: string };
  pull_request?: { body?: string | null; draft?: boolean; head?: { sha?: string } };
};

type IssueRecord = { state?: string; pull_request?: unknown };

export async function validateIssueLinkage(
  references: Array<{ number: number; repository: string }>,
  repository: string,
  fetchIssue: (repository: string, number: number) => Promise<IssueRecord>,
): Promise<string[]> {
  if (references.length !== 1) return [`expected exactly one closing reference, found ${references.length}`];
  const reference = references[0];
  if (reference.repository.toLowerCase() !== repository.toLowerCase()) return [`closing reference targets foreign repository ${reference.repository}`];
  try {
    const issue = await fetchIssue(repository, reference.number);
    if (issue.pull_request) return [`#${reference.number} is a pull request, not an issue`];
    if (issue.state !== "open") return [`#${reference.number} is not open`];
    return [];
  } catch (error) {
    return [`issue lookup for ${repository}#${reference.number} is unverifiable: ${error instanceof Error ? error.message : "request failed"}`];
  }
}

export function closingReferences(body: string, repository: string): Array<{ number: number; repository: string }> {
  const text = body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "").replace(/`[^`]*`/g, "").replace(/^\s*>.*$/gm, "");
  const references: Array<{ number: number; repository: string }> = [];
  const pattern = /^\s*(?:[-*+]\s*)?(?:Fixes|Closes|Resolves)\s+((?:[\w.-]+\/[\w.-]+)?#\d+)(?=\s|$)/gim;
  for (const match of text.matchAll(pattern)) {
    const target = match[1];
    const parsed = target.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
    references.push({ number: Number(parsed?.[3] ?? target.slice(1)), repository: parsed ? `${parsed[1]}/${parsed[2]}` : repository });
  }
  return references;
}

export function validatePrBody(body: string, headSha: string): string[] {
  const errors: string[] = [];
  if (closingReferences(body, "ptstory/tracer-workflow").length === 0 && !/^Refs\s+(?:[\w.-]+\/[\w.-]+)?#\d+\s*$/im.test(body)) {
    errors.push("missing Fixes/Closes/Resolves issue reference or standalone Refs #N for a partial draft");
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

async function main(): Promise<void> {
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
  const repository = event.repository?.full_name;
  if (!repository) {
    console.error("pull request event is missing repository identity");
    process.exit(2);
  }
  const references = closingReferences(body ?? "", repository);
  const linkageErrors = await validateIssueLinkage(references, repository, async (repo, number) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues/${number}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    return await response.json() as IssueRecord;
  });
  if (linkageErrors.length) {
    for (const error of linkageErrors) console.error(error);
    process.exit(1);
  }
  console.log(`PR body and issue linkage passed for head ${sha}`);
}

if (import.meta.main) {
  main();
}
