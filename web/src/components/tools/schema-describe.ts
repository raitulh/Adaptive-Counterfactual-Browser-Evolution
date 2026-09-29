/**
 * Turns a JSON Schema (tool input/output schemas as published by the backend, pydantic-generated
 * or MCP-advertised) into readable parameter rows. Only local `#/…` references are followed.
 */

type Json = Record<string, unknown>;

export interface SchemaRow {
  /** Dotted path for nested properties ("attendees[]", "options.mode"). */
  path: string;
  name: string;
  depth: number;
  type: string;
  required: boolean;
  nullable: boolean;
  description?: string;
  constraints: string[];
  enumValues?: string[];
  defaultValue?: string;
}

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function resolveRef(root: Json, node: Json, seen: Set<string>): Json {
  const ref = node.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/") || seen.has(ref)) return node;
  seen.add(ref);
  let target: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    target = isObj(target) ? target[key] : undefined;
  }
  if (!isObj(target)) return node;
  const { $ref: _ignored, ...rest } = node;
  void _ignored;
  return { ...resolveRef(root, target, seen), ...rest };
}

/** Collapse `anyOf: [X, {type: null}]` (pydantic Optional) into X + nullable. */
function unwrapNullable(node: Json): { node: Json; nullable: boolean } {
  const variants = (node.anyOf ?? node.oneOf) as unknown;
  if (Array.isArray(variants)) {
    const nonNull = variants.filter((v) => !(isObj(v) && v.type === "null"));
    if (nonNull.length === 1 && nonNull.length < variants.length && isObj(nonNull[0])) {
      const { anyOf: _a, oneOf: _o, ...rest } = node;
      void _a;
      void _o;
      return { node: { ...nonNull[0], ...rest }, nullable: true };
    }
  }
  if (Array.isArray(node.type) && node.type.includes("null")) {
    const types = node.type.filter((t) => t !== "null");
    return { node: { ...node, type: types.length === 1 ? types[0] : types }, nullable: true };
  }
  return { node, nullable: false };
}

function typeLabel(root: Json, node: Json): string {
  if (typeof node.const !== "undefined") return "constant";
  if (Array.isArray(node.enum)) return "enum";
  const variants = (node.anyOf ?? node.oneOf) as unknown;
  if (Array.isArray(variants)) {
    return variants
      .map((v) => (isObj(v) ? typeLabel(root, unwrapNullable(resolveRef(root, v, new Set())).node) : "any"))
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(" | ");
  }
  const t = node.type;
  if (t === "array") {
    const items = isObj(node.items) ? unwrapNullable(resolveRef(root, node.items, new Set())).node : null;
    return items ? `${typeLabel(root, items)}[]` : "array";
  }
  if (Array.isArray(t)) return t.join(" | ");
  if (typeof t === "string") return node.format ? `${t} (${String(node.format)})` : t;
  if (isObj(node.properties)) return "object";
  return "any";
}

function show(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function constraintsOf(node: Json): string[] {
  const c: string[] = [];
  const pair = (min: string, max: string, unit: string) => {
    const lo = node[min];
    const hi = node[max];
    if (typeof lo === "number" && typeof hi === "number")
      c.push(lo === hi ? `exactly ${lo} ${unit}` : `${lo}–${hi} ${unit}`);
    else if (typeof lo === "number") c.push(`≥ ${lo} ${unit}`);
    else if (typeof hi === "number") c.push(`≤ ${hi} ${unit}`);
  };
  pair("minLength", "maxLength", "chars");
  pair("minItems", "maxItems", "items");
  const lo = node.minimum ?? node.exclusiveMinimum;
  const hi = node.maximum ?? node.exclusiveMaximum;
  if (typeof lo === "number" && typeof hi === "number") c.push(`${lo}–${hi}`);
  else if (typeof lo === "number") c.push(`${node.exclusiveMinimum !== undefined ? ">" : "≥"} ${lo}`);
  else if (typeof hi === "number") c.push(`${node.exclusiveMaximum !== undefined ? "<" : "≤"} ${hi}`);
  if (typeof node.pattern === "string") c.push(`pattern ${node.pattern}`);
  if (node.uniqueItems === true) c.push("unique items");
  return c;
}

/** Flatten a schema's properties (nested objects and object arrays up to `maxDepth`). */
export function describeSchema(schema: unknown, maxDepth = 3): SchemaRow[] {
  if (!isObj(schema)) return [];
  const root = schema;
  const rows: SchemaRow[] = [];
  const walk = (node: Json, prefix: string, depth: number) => {
    const resolved = resolveRef(root, node, new Set());
    const props = isObj(resolved.properties) ? resolved.properties : {};
    const required = new Set(Array.isArray(resolved.required) ? resolved.required.map(String) : []);
    for (const [name, raw] of Object.entries(props)) {
      if (!isObj(raw)) continue;
      const { node: prop, nullable } = unwrapNullable(resolveRef(root, raw, new Set()));
      const path = prefix ? `${prefix}.${name}` : name;
      const enumValues = Array.isArray(prop.enum)
        ? prop.enum.map(show)
        : typeof prop.const !== "undefined"
          ? [show(prop.const)]
          : undefined;
      rows.push({
        path,
        name,
        depth,
        type: typeLabel(root, prop),
        required: required.has(name),
        nullable,
        description:
          typeof prop.description === "string"
            ? prop.description
            : typeof raw.description === "string"
              ? raw.description
              : undefined,
        constraints: constraintsOf(prop),
        enumValues,
        defaultValue: "default" in raw ? show(raw.default) : "default" in prop ? show(prop.default) : undefined,
      });
      if (depth + 1 >= maxDepth) continue;
      if (isObj(prop.properties) || typeof prop.$ref === "string") walk(prop, path, depth + 1);
      else if (prop.type === "array" && isObj(prop.items)) {
        const items = unwrapNullable(resolveRef(root, prop.items, new Set())).node;
        if (isObj(items.properties)) walk(items, `${path}[]`, depth + 1);
      }
    }
  };
  walk(root, "", 0);
  return rows;
}

/** Whether the schema allows properties beyond those listed. */
export function allowsAdditional(schema: unknown): boolean {
  return !(isObj(schema) && schema.additionalProperties === false);
}
