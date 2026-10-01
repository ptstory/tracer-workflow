import { describe, expect, test } from "bun:test";

import { checkPackage, compareVersions, INSTRUCTIONS_LIMIT, readmeSourcePaths } from "./check-gpt-package";

const readme = `| GPT field | Source |
|---|---|
| Instructions | \`actions/review-gate-gpt/v9.9.9/custom-gpt-instructions.md\` |
| Knowledge | \`skills/review-gate/references/verdict-contract.md\` (canonical) |

Prose mentioning \`actions/not-a-table-row.md\` is ignored.
`;

const allExist = () => true;

describe("Review Gate GPT package check", () => {
  test("passes when instructions fit and every table path exists", () => {
    expect(checkPackage("x".repeat(INSTRUCTIONS_LIMIT), readme, allExist)).toEqual([]);
  });

  test("counts characters, not bytes", () => {
    expect(checkPackage("—".repeat(INSTRUCTIONS_LIMIT), readme, allExist)).toEqual([]);
  });

  test("fails when instructions exceed the limit", () => {
    const errors = checkPackage("x".repeat(INSTRUCTIONS_LIMIT + 1), readme, allExist);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`${INSTRUCTIONS_LIMIT + 1} characters`);
  });

  test("fails when a table path is missing", () => {
    const errors = checkPackage("ok", readme, (path) => !path.startsWith("skills/"));
    expect(errors).toEqual(["README.md names a missing file: skills/review-gate/references/verdict-contract.md"]);
  });

  test("fails when a repository path outside actions and skills is missing", () => {
    const missingPathReadme = `${readme}\n| Knowledge | \`docs/missing.md\` |`;
    const errors = checkPackage("ok", missingPathReadme, (path) => path !== "docs/missing.md");
    expect(errors).toEqual(["README.md names a missing file: docs/missing.md"]);
  });

  test("fails when the README table names no source paths", () => {
    expect(checkPackage("ok", "no table here", allExist)).toEqual(["README.md names no repository source paths in its table"]);
  });

  test("reads paths from table rows only", () => {
    expect(readmeSourcePaths(readme)).toEqual([
      "actions/review-gate-gpt/v9.9.9/custom-gpt-instructions.md",
      "skills/review-gate/references/verdict-contract.md",
    ]);
  });

  test("orders versions numerically", () => {
    expect(["v1.10.0", "v1.2.0", "v1.1.0"].sort(compareVersions)).toEqual(["v1.1.0", "v1.2.0", "v1.10.0"]);
  });
});
