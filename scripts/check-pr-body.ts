import { readFileSync } from "node:fs";

function formatDiagnostic(expected: string, found: string, action: string): string {
  return `Expected: ${expected}; found: ${found}; action: ${action}`;
}

const sections = ["Summary", "Evidence", "Merge Danger", "Docs"] as const;

type PullRequestEvent = {
  pull_request?: { number?: number; head?: { sha?: string } };
};

type GitHubPullRequest = { body?: string | null };

export function validatePrBody(body: string, headSha: string): string[] {
  const errors: string[] = [];
  if (!/\b(?:Fixes|Closes|Resolves)\s+(?:[\w.-]+\/[\w.-]+)?#\d+\b/i.test(body)) {
    errors.push(formatDiagnostic("a Fixes/Closes/Resolves issue reference", "none", "add the governing issue reference"));
  }

  const headings = [...body.matchAll(/^## (Summary|Evidence|Merge Danger|Docs)\s*$/gm)];
  for (const section of sections) {
    if (!headings.some((heading) => heading[1] === section)) {
      errors.push(formatDiagnostic(`a ## ${section} section`, "section missing", `add the required ${section} section`));
    }
  }

  const evidence = headings.find((heading) => heading[1] === "Evidence");
  if (evidence) {
    const start = evidence.index! + evidence[0].length;
    const end = body.slice(start).search(/^## /m);
    const content = body.slice(start, end < 0 ? undefined : start + end);
    const sha = content.match(/^\s*-?\s*Head SHA:\s*([0-9a-f]{40})\s*$/im)?.[1];
    if (!sha || sha.toLowerCase() !== headSha.toLowerCase()) {
      errors.push(formatDiagnostic(`Evidence Head SHA ${headSha}`, sha ?? "missing or malformed", "regenerate evidence for this head and update the PR body"));
    }
  }
  return errors;
}

export async function fetchPullRequestBody(
  number: number,
  repository: string,
  token: string,
  apiUrl: string,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetcher(`${apiUrl}/repos/${repository}/pulls/${number}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch {
    throw new Error(formatDiagnostic("a successful GitHub API response", "request failed", "verify API access and retry"));
  }
  if (!response.ok) {
    throw new Error(formatDiagnostic("HTTP 200 with the live PR body", `HTTP ${response.status}`, "verify GH_TOKEN has pull-requests: read access and the PR number is valid"));
  }
  let pullRequest: GitHubPullRequest;
  try {
    pullRequest = await response.json() as GitHubPullRequest;
  } catch {
    throw new Error(formatDiagnostic("a valid GitHub PR response", "response body is invalid JSON", "verify the GitHub API response and retry"));
  }
  if (pullRequest === null || typeof pullRequest !== "object" || !Object.hasOwn(pullRequest, "body") || (pullRequest.body !== null && typeof pullRequest.body !== "string")) {
    throw new Error(formatDiagnostic("a string or null PR body", "body is missing or has an invalid type", "verify the GitHub API response and retry"));
  }
  return pullRequest.body;
}

async function main(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.error(formatDiagnostic("GITHUB_EVENT_PATH to name a pull request event", "unset", "run this check in a GitHub Actions pull_request_target job with the trusted default-branch validator"));
    process.exitCode = 2;
    return;
  }

  let event: PullRequestEvent;
  try {
    event = JSON.parse(readFileSync(eventPath, "utf8")) as PullRequestEvent;
  } catch {
    console.error(formatDiagnostic("a readable pull request event", "event file is missing or invalid JSON", "restore the GitHub Actions event file and rerun"));
    process.exitCode = 2;
    return;
  }

  const number = event.pull_request?.number;
  const sha = event.pull_request?.head?.sha;
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0 || typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) {
    console.error(formatDiagnostic("a positive PR number and a 40-character head SHA", `number=${String(number)}, head SHA=${String(sha)}`, "run this check with a valid pull request event"));
    process.exitCode = 2;
    return;
  }

  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  const apiUrl = process.env.GITHUB_API_URL;
  if (!repository || !token || !apiUrl || !/^https?:\/\//.test(apiUrl) || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    console.error(formatDiagnostic("a valid GITHUB_REPOSITORY, GH_TOKEN, and GITHUB_API_URL", `repository=${repository ? "set" : "unset"}, token=${token ? "set" : "unset"}, API URL=${apiUrl ? "set" : "unset"}`, "configure pull_request_target with the trusted default-branch validator, pull-requests: read, and GH_TOKEN"));
    process.exitCode = 2;
    return;
  }

  let body: string | null;
  try {
    body = await fetchPullRequestBody(number, repository, token, apiUrl);
  } catch (error) {
    console.error(error instanceof Error ? error.message : formatDiagnostic("a live PR body from GitHub", "request failed", "verify API access and retry"));
    process.exitCode = 2;
    return;
  }

  const errors = validatePrBody(body ?? "", sha);
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(`PR body contract passed for event head ${sha}`);
}

if (import.meta.main) {
  await main();
}
