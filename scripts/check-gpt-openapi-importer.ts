#!/usr/bin/env bun
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const actionsRoot = resolve(root, "actions");
const legacyPrefix = "actions/review-gate-gpt/v1.0.0/";

type Mapping = Record<string, unknown>;

function isMapping(value: unknown): value is Mapping {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function walk(value: unknown, path: string, visit: (value: Mapping, path: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}.${index}`, visit));
  } else if (isMapping(value)) {
    visit(value, path);
    for (const [key, child] of Object.entries(value)) {
      walk(child, path ? `${path}.${key}` : key, visit);
    }
  }
}

export function checkSchemas(document: unknown): string[] {
  if (!isMapping(document) || !isMapping(document.components)) return [];
  const schemas = document.components.schemas;
  if (schemas === undefined) return [];
  if (!isMapping(schemas)) return ["components.schemas: expected a mapping"];
  const issues: string[] = [];
  walk(schemas, "components.schemas", (value, path) => {
    if (value.type === "object" && (!isMapping(value.properties) || Object.keys(value.properties).length === 0)) {
      issues.push(`${path}: object schema has no properties`);
    }
  });
  return issues;
}

export function checkOpenApi(document: unknown): string[] {
  const issues: string[] = [];
  walk(document, "", (value, path) => {
    if (typeof value.$ref === "string" && value.$ref.startsWith("#/components/parameters")) {
      issues.push(`${path}: unsupported parameter reference ${value.$ref}`);
    }
  });
  return [...issues, ...checkSchemas(document)];
}

function yamlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return yamlFiles(path);
    return entry.isFile() && /\.ya?ml$/i.test(entry.name) ? [path] : [];
  }).sort();
}

export function runImporterCheck(directory = actionsRoot): number {
  let known = 0;
  let failures = 0;
  let checked = 0;
  for (const file of yamlFiles(directory)) {
    const name = relative(root, file).replaceAll("\\", "/");
    const legacy = name.startsWith(legacyPrefix);
    checked++;
    try {
      const issues = checkOpenApi(Bun.YAML.parse(readFileSync(file, "utf8")));
      for (const issue of issues) {
        if (legacy) known++;
        else failures++;
        console.error(`${legacy ? "KNOWN v1.0.0" : "FAIL"} ${name}: ${issue}`);
      }
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}: ${String(error)}`);
    }
  }
  console.log(`gpt-openapi-importer: ${checked} files checked, ${known} known v1.0.0 failures, ${failures} blocking failures`);
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = runImporterCheck();
