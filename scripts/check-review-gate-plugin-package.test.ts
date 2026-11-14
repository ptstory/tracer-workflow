import { describe, expect, test } from "bun:test";

import {
  checkPluginPackage,
  compareVersions,
  REQUIRED_DEFAULT_PROMPT_MARKER,
  REQUIRED_LIVE_CONTRACT_PATHS,
  REQUIRED_PACKAGE_PATHS,
  REQUIRED_PUBLICATION_MARKERS,
} from "./check-review-gate-plugin-package";

const packageRoot = "/repo/actions/review-gate-plugin/v0.1.0/review-gate";
const manifest = JSON.stringify({
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "review-gate",
  version: "0.1.0",
  extensions: {
    "com.openai": {
      interface: {
        defaultPrompt: [`Review and ${REQUIRED_DEFAULT_PROMPT_MARKER}.`],
      },
    },
  },
});
const skill = [...REQUIRED_LIVE_CONTRACT_PATHS, ...REQUIRED_PUBLICATION_MARKERS].join("\n");
const allExist = () => true;

describe("Review Gate plugin package check", () => {
  test("passes a matching package", () => {
    expect(checkPluginPackage("v0.1.0", packageRoot, manifest, skill, allExist)).toEqual([]);
  });

  test("requires every deployed package file", () => {
    const missing = `${packageRoot}/${REQUIRED_PACKAGE_PATHS[2]}`;
    expect(
      checkPluginPackage("v0.1.0", packageRoot, manifest, skill, (path) => path !== missing),
    ).toContain(`missing package file: ${REQUIRED_PACKAGE_PATHS[2]}`);
  });

  test("requires manifest version to match directory version", () => {
    const wrong = manifest.replace('"version":"0.1.0"', '"version":"0.2.0"');
    expect(checkPluginPackage("v0.1.0", packageRoot, wrong, skill, allExist)).toContain(
      "plugin.json version must match version directory 0.1.0",
    );
  });

  test("requires package name to match package directory", () => {
    const wrong = manifest.replace('"name":"review-gate"', '"name":"other"');
    expect(checkPluginPackage("v0.1.0", packageRoot, wrong, skill, allExist)).toContain(
      "plugin.json name must match package directory review-gate",
    );
  });

  test("requires the deployed compatibility manifest", () => {
    const missing = `${packageRoot}/.codex-plugin/plugin.json`;
    expect(
      checkPluginPackage("v0.1.0", packageRoot, manifest, skill, (path) => path !== missing),
    ).toContain("missing package file: .codex-plugin/plugin.json");
  });

  test("requires publish-by-default skill policy", () => {
    const incomplete = skill.replace(REQUIRED_PUBLICATION_MARKERS[0], "");
    expect(checkPluginPackage("v0.1.0", packageRoot, manifest, incomplete, allExist)).toContain(
      `SKILL.md missing default-publication marker: ${REQUIRED_PUBLICATION_MARKERS[0]}`,
    );
  });

  test("requires a publish-by-default manifest prompt", () => {
    const wrong = manifest.replace(REQUIRED_DEFAULT_PROMPT_MARKER, "return the Review Record in chat");
    expect(checkPluginPackage("v0.1.0", packageRoot, wrong, skill, allExist)).toContain(
      "plugin.json default prompt must publish the canonical Review Record",
    );
  });

  test("requires every live contract pointer in the skill", () => {
    const incomplete = REQUIRED_LIVE_CONTRACT_PATHS.slice(1).join("\n");
    expect(checkPluginPackage("v0.1.0", packageRoot, manifest, incomplete, allExist)).toContain(
      `SKILL.md does not reference live Tracer contract: ${REQUIRED_LIVE_CONTRACT_PATHS[0]}`,
    );
  });

  test("rejects invalid JSON", () => {
    expect(checkPluginPackage("v0.1.0", packageRoot, "{", skill, allExist)).toEqual([
      "plugin.json is not valid JSON",
    ]);
  });

  test("orders versions numerically", () => {
    expect(["v0.10.0", "v0.2.0", "v0.1.0"].sort(compareVersions)).toEqual([
      "v0.1.0",
      "v0.2.0",
      "v0.10.0",
    ]);
  });
});
