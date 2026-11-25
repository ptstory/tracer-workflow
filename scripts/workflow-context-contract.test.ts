import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const workflow = readFileSync(resolve(import.meta.dir, "../WORKFLOW.md"), "utf8");
const context = readFileSync(resolve(import.meta.dir, "../CONTEXT.md"), "utf8");
const triageQueue = readFileSync(resolve(import.meta.dir, "../prompts/triage-queue.md"), "utf8");
const agentBrief = readFileSync(resolve(import.meta.dir, "../prompts/agent-brief.md"), "utf8");
const verdictContract = readFileSync(
  resolve(import.meta.dir, "../skills/review-gate/references/verdict-contract.md"),
  "utf8",
);
const stageInventory = readFileSync(
  resolve(import.meta.dir, "../docs/architecture/WORKFLOW-STAGE-INVENTORY.md"),
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

  test("covers every stage declared in the workflow table", () => {
    const declaredStages = Array.from(workflow.matchAll(/^\| `([^`]+)` \|/gm), (match) => match[1]);

    expect(declaredStages.length).toBeGreaterThan(0);
    for (const stage of declaredStages) {
      expect(stageInventory).toContain(`\`${stage}\``);
    }
    for (const stage of ["gh-triage-queue", "to-issues", "requesting-code-review", "receiving-code-review"]) {
      expect(stageInventory).toContain(`\`${stage}\``);
    }
  });

  test("routes substantive planning through continuity preflight and preserves exemptions", () => {
    const routingSection = workflow.split("`continuity-preflight` is the scoped read-only intake")[1]?.split("`triage-queue` is an optional shallow")[0] ?? "";
    expect(routingSection).toMatch(/before substantial planning\s+for a new topic and before a substantive planning write/);
    expect(routingSection).toContain("prompts/continuity-preflight.md");
    expect(workflow).toMatch(/Routine CI,\s+review, and status handling, and execution of an existing issue with a complete\s+contract, do not trigger another full preflight\./);
    expect(triageQueue).toMatch(/not a substitute for the read-only scoped\s+\[`continuity-preflight`\]\(\.\/continuity-preflight\.md\)/);
    expect(agentBrief).toMatch(/For substantive planning of a new topic or a material scope\/priority\/sequence\s+write, first use the read-only scoped\s+\[`continuity-preflight`\]\(\.\/continuity-preflight\.md\)/);
    expect(triageQueue).toMatch(/routine queue\/review\/CI\/status\s+handling and execution of a complete existing issue do not require a repeat/);
    expect(agentBrief).toMatch(/Do not repeat it for execution of an\s+existing issue with a complete contract or routine CI\/review\/status handling\./);
  });

  test("gives every canonical inventory row an evidence and drift status", () => {
    const inventoryTable = stageInventory.split("## Canonical stage inventory")[1]?.split("## Personal policy boundary")[0] ?? "";
    const inventoryRows = inventoryTable.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Stage / policy"));

    expect(inventoryRows.length).toBeGreaterThan(0);
    for (const row of inventoryRows) {
      expect(row.split("|")).toHaveLength(9);
      expect(row).toMatch(/\*\*(clean|drift|unverifiable)\*\*/);
    }
  });
});
