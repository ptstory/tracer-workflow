import { describe, expect, test } from "bun:test";

import { fetchPullRequestBody, validatePrBody } from "./check-pr-body";

type PullRequestEvent = {
  pull_request?: { number?: number; head?: { sha?: string } };
};

const sha = "a".repeat(40);
const valid = `Closes #160

## Summary

A diagram.

## Evidence

- Head SHA: ${sha}
- Verification: bun test (exit 0)

## Merge Danger

Door: two-way

## Docs

Updated the PR body contract.
`;

describe("PR body validation", () => {
  test("accepts a complete body for the current head", () => {
    expect(validatePrBody(valid, sha)).toEqual([]);
  });

  test("accepts alternative closing verbs and qualified issue references", () => {
    expect(validatePrBody(valid.replace("Closes #160", "Resolves ptstory/tracer-workflow#160"), sha)).toEqual([]);
    expect(validatePrBody(valid.replace("Closes #160", "Fixes #160"), sha)).toEqual([]);
  });

  test("rejects a missing closing reference", () => {
    expect(validatePrBody(valid.replace("Closes #160", "Related to #160"), sha)[0]).toBe("Expected: a Fixes/Closes/Resolves issue reference; found: none; action: add the governing issue reference");
  });

  test("rejects each missing section, not mentions in prose", () => {
    for (const section of ["Summary", "Evidence", "Merge Danger", "Docs"]) {
      expect(validatePrBody(valid.replace(`## ${section}`, `Note: ${section}`), sha).join("\n")).toContain(`Expected: a ## ${section} section; found: section missing; action: add the required ${section} section`);
    }
  });

  test("rejects a stale, malformed, or misplaced SHA", () => {
    expect(validatePrBody(valid, "b".repeat(40))[0]).toBe(`Expected: Evidence Head SHA ${"b".repeat(40)}; found: ${sha}; action: regenerate evidence for this head and update the PR body`);
    expect(validatePrBody(valid.replace(sha, "a".repeat(39)), sha)[0]).toBe(`Expected: Evidence Head SHA ${sha}; found: missing or malformed; action: regenerate evidence for this head and update the PR body`);
    expect(validatePrBody(valid.replace(`- Head SHA: ${sha}`, "No head SHA"), sha)[0]).toBe(`Expected: Evidence Head SHA ${sha}; found: missing or malformed; action: regenerate evidence for this head and update the PR body`);
  });

  test("reports expected, found, and action for each contract error", () => {
    const errors = validatePrBody("unstructured body", sha);
    expect(errors).toHaveLength(5);
    expect(errors.every((error) => error.startsWith("Expected: "))).toBe(true);
    expect(errors.every((error) => error.includes("; found: "))).toBe(true);
    expect(errors.every((error) => error.includes("; action: "))).toBe(true);
  });
});

describe("pull request event shape", () => {
  test("has only the PR number and head for live-body validation", () => {
    const event: PullRequestEvent = { pull_request: { number: 241, head: { sha } } };
    expect(event.pull_request?.number).toBe(241);
    expect(event.pull_request?.head?.sha).toBe(sha);
  });

  test("validates body against the event head SHA", () => {
    const bodyWithStaleSha = valid.replace(`- Head SHA: ${sha}`, `- Head SHA: ${"b".repeat(40)}`);
    expect(validatePrBody(bodyWithStaleSha, sha)[0]).toBe(`Expected: Evidence Head SHA ${sha}; found: ${"b".repeat(40)}; action: regenerate evidence for this head and update the PR body`);
  });
});

describe("live PR body retrieval", () => {
  test("fetches the edited body from GitHub with the provided token", async () => {
    let requestUrl = "";
    let requestHeaders: HeadersInit | undefined;
    const body = await fetchPullRequestBody(241, "ptstory/tracer-workflow", "test-token", "https://api.github.test", async (input, init) => {
      requestUrl = String(input);
      requestHeaders = init?.headers;
      return new Response(JSON.stringify({ body: valid }), { status: 200 });
    });

    expect(requestUrl).toBe("https://api.github.test/repos/ptstory/tracer-workflow/pulls/241");
    expect(new Headers(requestHeaders).get("Authorization")).toBe("Bearer test-token");
    expect(new Headers(requestHeaders).get("Accept")).toBe("application/vnd.github+json");
    expect(new Headers(requestHeaders).get("X-GitHub-Api-Version")).toBe("2022-11-28");
    expect(body).toBe(valid);
    expect(validatePrBody(body ?? "", sha)).toEqual([]);
    expect(validatePrBody(valid.replace(`- Head SHA: ${sha}`, `- Head SHA: ${"b".repeat(40)}`), sha)[0])
      .toBe(`Expected: Evidence Head SHA ${sha}; found: ${"b".repeat(40)}; action: regenerate evidence for this head and update the PR body`);
  });

  test("reports non-success responses with expected, found, and action", async () => {
    await expect(fetchPullRequestBody(241, "ptstory/tracer-workflow", "test-token", "https://api.github.test", async () =>
      new Response("not found", { status: 404 }),
    )).rejects.toThrow("Expected: HTTP 200 with the live PR body; found: HTTP 404; action:");
  });

  test("rejects malformed and invalid PR body responses", async () => {
    await expect(fetchPullRequestBody(241, "ptstory/tracer-workflow", "test-token", "https://api.github.test", async () =>
      new Response("not json", { status: 200 }),
    )).rejects.toThrow("Expected: a valid GitHub PR response; found: response body is invalid JSON; action: verify the GitHub API response and retry");
    await expect(fetchPullRequestBody(241, "ptstory/tracer-workflow", "test-token", "https://api.github.test", async () =>
      new Response(JSON.stringify({ body: 42 }), { status: 200 }),
    )).rejects.toThrow("Expected: a string or null PR body; found: body is missing or has an invalid type; action: verify the GitHub API response and retry");
    await expect(fetchPullRequestBody(241, "ptstory/tracer-workflow", "test-token", "https://api.github.test", async () =>
      new Response(JSON.stringify({ number: 241 }), { status: 200 }),
    )).rejects.toThrow("Expected: a string or null PR body; found: body is missing or has an invalid type; action: verify the GitHub API response and retry");
  });

  test("reports request failures", async () => {
    await expect(fetchPullRequestBody(241, "ptstory/tracer-workflow", "test-token", "https://api.github.test", async () => {
      throw new Error("network unavailable");
    })).rejects.toThrow("Expected: a successful GitHub API response; found: request failed; action:");
  });
});
