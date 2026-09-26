import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { checkOpenApi, checkSchemas } from "./check-gpt-openapi-importer";

const root = resolve(import.meta.dir, "..");

function schema(path: string): unknown {
  return Bun.YAML.parse(readFileSync(resolve(root, path), "utf8"));
}

describe("Custom GPT OpenAPI importer checks", () => {
  test("detects parameter references at any depth", () => {
    expect(checkOpenApi({ paths: { "/x": { get: { parameters: [{ $ref: "#/components/parameters/Owner" }] } } } }))
      .toContain("paths./x.get.parameters.0: unsupported parameter reference #/components/parameters/Owner");
  });

  test("detects objects without properties including array items", () => {
    expect(checkOpenApi({ components: { schemas: { AnyObject: { type: "object", additionalProperties: true }, AnyArray: { type: "array", items: { type: "object" } } } } }))
      .toEqual([
        "components.schemas.AnyObject: object schema has no properties",
        "components.schemas.AnyArray.items: object schema has no properties",
      ]);
  });

  test("accepts populated objects and arbitrary schema references", () => {
    expect(checkOpenApi({
      components: { schemas: {
        AnyObject: { type: "object", properties: { _placeholder: { type: "string" } } },
        AnyArray: { type: "array", items: { type: "object", properties: { _placeholder: { type: "string" } } } },
      } },
      paths: { "/x": { get: { responses: { "200": { schema: { $ref: "#/components/schemas/AnyObject" } } } } } },
    })).toEqual([]);
  });

  test("rejects malformed schema input", () => {
    expect(checkSchemas({ components: { schemas: [] } })).toContain("components.schemas: expected a mapping");
  });

  test("v1.1.0 is importable while immutable v1.0.0 reports known failures", () => {
    expect(checkOpenApi(schema("actions/review-gate-gpt/v1.1.0/actions/github-review-gate.openapi.yaml"))).toEqual([]);
    expect(checkOpenApi(schema("actions/review-gate-gpt/v1.0.0/actions/github-review-gate.openapi.yaml")).length).toBeGreaterThan(0);
  });
});
