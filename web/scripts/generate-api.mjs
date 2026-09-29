#!/usr/bin/env node
/**
 * Generates the typed AgentOS API contract from the backend's OpenAPI document.
 *
 *   npm run api:generate                      # from ../backend/docs/openapi.json
 *   OPENAPI_SOURCE=http://localhost:8000/api/v1/openapi.json npm run api:generate
 *   npm run api:check                         # CI: fail when the generated files are stale
 *
 * Outputs (never edit by hand):
 *   src/lib/api/generated/schema.ts    – openapi-typescript types, enum value arrays, root type aliases
 *   src/lib/api/generated/contract.ts  – contract fingerprint used by the dev-time drift check
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(root, "src/lib/api/generated");
const source = process.env.OPENAPI_SOURCE ?? path.resolve(root, "../backend/docs/openapi.json");
const checkOnly = process.argv.includes("--check");

/** Deterministic JSON: object keys sorted recursively (mirrors src/lib/api/contract-drift.ts). */
export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function loadDocument() {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Could not fetch ${source}: HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(await readFile(source, "utf8"));
}

const HEADER = `/**
 * GENERATED FILE — DO NOT EDIT.
 * Source: backend OpenAPI document (backend/docs/openapi.json). Regenerate with \`npm run api:generate\`.
 */
`;

async function main() {
  const doc = await loadDocument();
  const ast = await openapiTS(doc, {
    enumValues: true,
    rootTypes: true,
    rootTypesNoSchemaPrefix: true,
    alphabetize: true,
    defaultNonNullable: false,
  });
  const schemaTs = HEADER + astToString(ast);

  // Only paths + components define the contract (info/servers vary by deployment).
  const fingerprint = createHash("sha256")
    .update(canonicalize({ paths: doc.paths, components: doc.components }))
    .digest("hex");
  const contractTs = `${HEADER}
/** SHA-256 of the canonical JSON of { paths, components } of the backend OpenAPI document. */
export const CONTRACT_FINGERPRINT = ${JSON.stringify(fingerprint)};
export const CONTRACT_API_VERSION = ${JSON.stringify(doc.info?.version ?? "unknown")};
export const CONTRACT_PATH_COUNT = ${Object.keys(doc.paths ?? {}).length};
`;

  const outputs = [
    [path.join(outDir, "schema.ts"), schemaTs],
    [path.join(outDir, "contract.ts"), contractTs],
  ];

  if (checkOnly) {
    let stale = false;
    for (const [file, content] of outputs) {
      const current = await readFile(file, "utf8").catch(() => "");
      if (current !== content) {
        console.error(`✗ ${path.relative(root, file)} is out of date with the backend OpenAPI document.`);
        stale = true;
      }
    }
    if (stale) {
      console.error("Run `npm run api:generate` and commit the result.");
      process.exit(1);
    }
    console.log(`✓ API contract is up to date (${fingerprint.slice(0, 12)}…, ${Object.keys(doc.paths).length} paths)`);
    return;
  }

  await mkdir(outDir, { recursive: true });
  for (const [file, content] of outputs) await writeFile(file, content);
  console.log(`✓ Generated API contract from ${source} (${fingerprint.slice(0, 12)}…, ${Object.keys(doc.paths).length} paths)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
