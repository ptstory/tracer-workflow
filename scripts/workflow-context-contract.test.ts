import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const workflow = readFileSync(resolve(import.meta.dir, "../WORKFLOW.md"), "utf8");
const context = readFileSync(resolve(import.meta.dir, "../CONTEXT.md"), "utf8");
const verdictContract = readFileSync(
  resolve(import.meta.dir, "../skills/review-gate/references/verdict-contract.md"),
  "utf8",
);

describe("workflow and context operational contract", () => {
  test("keeps HITL as the default and requires explicit AFK authorization", () => {
    for (const document of [workflow, context]) {
      expect(document).toMatch(/An issue is HITL by default; AFK applies only when the issue explicitly says so\./);
    }
  });

  test("preserves human merge authority for HITL and gated landing for AFK", () => {
    expect(workflow).toMatch(/\*\*AFK issue\*\*:[\s\S]*?land it once the check-run gate is green\./);
    expect(workflow).toMatch(/\*\*HITL issue\*\*:[\s\S]*?the human owns the merge button\.[\s\S]*?do not merge\./);
    expect(context).toMatch(/\*\*AFK\*\* pre-authorizes the\s+autonomous path through merge once the check-run gate is green\./);
    expect(context).toMatch(/\*\*HITL\*\* means\s+the human owns the merge button/);
  });

  test("keeps the docs-only allowlist and ordinary coverage boundary unchanged", () => {
    expect(verdictContract.match(/^- Docs-only allowlist: (.+)$/m)?.[1]).toBe(
      "`README.md`, `RUNTIME.md`, `STACK.md`, and `docs/**`.",
    );
    expect(verdictContract.match(/^- Docs-only allowlist:/gm)).toHaveLength(1);
    expect(verdictContract).toMatch(/`CONTEXT\.md`, `WORKFLOW\.md`, `AGENTS\.md`,/);
    expect(verdictContract).toMatch(/Any non-allowlisted path, including a mixed PR, uses the\s+ordinary path-coverage rules below\./);
    expect(verdictContract).toMatch(/and at least one applicable required check exercises the changed paths\./);
  });
});
