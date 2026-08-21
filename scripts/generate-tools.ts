/**
 * Generates generated/tools.json from Apple's Apple Ads Platform API OpenAPI spec.
 * Every path+method becomes one MCP tool. Re-run after replacing the OpenAPI file.
 *
 *   bun run generate
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SPEC_PATH = join(ROOT, "openapi", "apple-ads.openapi.json");
const OUT_PATH = join(ROOT, "generated", "tools.json");
const MANIFEST_PATH = join(ROOT, "generated", "manifest.json");
const DOCS_PATH = join(ROOT, "generated", "docs.json");

type JsonSchema = Record<string, unknown>;

type OpenApiParam = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  schema?: JsonSchema;
  style?: string;
  explode?: boolean;
};

type OpenApiOp = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParam[];
  requestBody?: {
    required?: boolean;
    description?: string;
    content?: Record<string, { schema?: JsonSchema }>;
  };
  responses?: Record<string, unknown>;
  deprecated?: boolean;
};

type PathItem = OpenApiOp & {
  parameters?: OpenApiParam[];
  get?: OpenApiOp;
  post?: OpenApiOp;
  put?: OpenApiOp;
  patch?: OpenApiOp;
  delete?: OpenApiOp;
  head?: OpenApiOp;
  options?: OpenApiOp;
};

type OpenApiSpec = {
  openapi: string;
  info: { title?: string; version?: string };
  paths: Record<string, PathItem>;
  components?: { schemas?: Record<string, JsonSchema> };
};

type DocEntry = { title?: string; abstract?: string; url?: string };

export type GeneratedTool = {
  /** MCP tool name (unique, length-safe) */
  name: string;
  /** Original OpenAPI operationId */
  operationId: string;
  method: string;
  path: string;
  tags: string[];
  description: string;
  deprecated?: boolean;
  /** JSON Schema for tool input (object) */
  inputSchema: JsonSchema;
  /** path param names in template order */
  pathParams: string[];
  /** query param names */
  queryParams: string[];
  /** header param names (e.g. X-Ap-Context) */
  headerParams: string[];
  hasBody: boolean;
  bodyRequired: boolean;
  /** request body media type, e.g. application/json or multipart/form-data */
  contentType?: string;
  /** 200 response media type */
  accept?: string;
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

function isContextHeader(name: string): boolean {
  const key = name.toLowerCase();
  return key === "x-ap-context" || key === "xapcontext";
}

function camelJoinWords(words: string[]): string {
  return words
    .map((w, i) => {
      const lw = w.toLowerCase();
      if (!lw) return "";
      return i === 0 ? lw : lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join("");
}

function splitSegmentWords(seg: string): string[] {
  return seg.split("-").filter(Boolean);
}

/** Derive a readable, deterministic base name from method + path (before collision suffixing). */
function deriveBaseName(method: string, path: string): string {
  const segments = path.replace(/^\//, "").split("/").filter(Boolean);
  const resource = camelJoinWords(splitSegmentWords(segments[0] || ""));
  const rest = segments.slice(1);
  const m = method.toUpperCase();

  if (rest.length === 0) {
    if (m === "GET") return `${resource}_list`;
    if (m === "POST") return `${resource}_create`;
  }

  if (rest.length === 1 && rest[0] === "query" && m === "POST") {
    return `${resource}_query`;
  }

  if (rest.length === 1 && /^\{.+\}$/.test(rest[0]!)) {
    if (m === "GET") return `${resource}_get`;
    if (m === "PUT") return `${resource}_update`;
    if (m === "DELETE") return `${resource}_delete`;
  }

  const words = rest
    .filter((s) => !/^\{.+\}$/.test(s))
    .flatMap(splitSegmentWords);
  const suffix = words.length ? camelJoinWords(words) : m.toLowerCase();
  return `${resource}_${suffix}`;
}

function simplifySchema(
  schema: JsonSchema | undefined,
  depth: number,
  components: Record<string, JsonSchema>,
  seen: Set<string>,
): JsonSchema {
  if (!schema || depth > 6) return { type: "object", additionalProperties: true };

  if (typeof schema.$ref === "string") {
    const ref = schema.$ref as string;
    const name = ref.replace(/^#\/components\/schemas\//, "");
    if (seen.has(name)) {
      return { type: "object", additionalProperties: true, description: `circular $ref ${name}` };
    }
    const resolved = components[name];
    if (!resolved) {
      return { type: "object", additionalProperties: true, description: `unresolved $ref ${name}` };
    }
    seen.add(name);
    const out = simplifySchema(resolved, depth + 1, components, seen);
    seen.delete(name);
    if (!out.description) out.description = name;
    return out;
  }

  if (Array.isArray(schema.allOf)) {
    // shallow merge
    const merged: JsonSchema = { type: "object", properties: {}, required: [] as string[] };
    const props: Record<string, JsonSchema> = {};
    const req = new Set<string>();
    for (const part of schema.allOf as JsonSchema[]) {
      const s = simplifySchema(part, depth + 1, components, seen);
      if (s.properties && typeof s.properties === "object") {
        Object.assign(props, s.properties);
      }
      if (Array.isArray(s.required)) for (const r of s.required) req.add(String(r));
      if (s.type && !merged.type) merged.type = s.type;
    }
    merged.properties = props;
    if (req.size) merged.required = [...req];
    return merged;
  }

  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const variants = (schema.oneOf || schema.anyOf) as JsonSchema[];
    return {
      description: schema.description as string | undefined,
      anyOf: variants.slice(0, 8).map((v) => simplifySchema(v, depth + 1, components, seen)),
    };
  }

  const out: JsonSchema = {};
  if (schema.type) out.type = schema.type;
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.format) out.format = schema.format;
  if (schema.default !== undefined) out.default = schema.default;
  if (schema.minimum !== undefined) out.minimum = schema.minimum;
  if (schema.maximum !== undefined) out.maximum = schema.maximum;
  if (schema.minLength !== undefined) out.minLength = schema.minLength;
  if (schema.maxLength !== undefined) out.maxLength = schema.maxLength;
  if (schema.pattern) out.pattern = schema.pattern;
  if (schema.nullable) out.nullable = schema.nullable;

  if (schema.type === "array" || schema.items) {
    out.type = out.type || "array";
    out.items = simplifySchema(
      (schema.items as JsonSchema) || { type: "string" },
      depth + 1,
      components,
      seen,
    );
  }

  if (schema.properties && typeof schema.properties === "object") {
    out.type = out.type || "object";
    const props: Record<string, JsonSchema> = {};
    const entries = Object.entries(schema.properties as Record<string, JsonSchema>);
    // Cap property explosion for giant JSON:API-style resource schemas
    const limit = depth <= 1 ? 80 : depth <= 3 ? 40 : 20;
    for (const [k, v] of entries.slice(0, limit)) {
      props[k] = simplifySchema(v, depth + 1, components, seen);
    }
    if (entries.length > limit) {
      out.additionalProperties = true;
      out.description = `${(out.description as string) || ""} (+${entries.length - limit} more properties; pass full JSON document)`.trim();
    }
    out.properties = props;
    if (Array.isArray(schema.required)) {
      out.required = (schema.required as string[]).filter((r) => r in props);
    }
  }

  if (schema.additionalProperties === true) {
    out.additionalProperties = true;
  } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    out.additionalProperties = simplifySchema(
      schema.additionalProperties as JsonSchema,
      depth + 1,
      components,
      seen,
    );
  }

  // OpenAPI 3 type arrays
  if (Array.isArray(schema.type)) {
    out.type = schema.type;
  }

  if (!out.type && !out.anyOf && !out.properties) {
    out.type = "object";
    out.additionalProperties = true;
  }

  return out;
}

function paramToSchema(
  p: OpenApiParam,
  components: Record<string, JsonSchema>,
): JsonSchema {
  const base = simplifySchema(p.schema || { type: "string" }, 0, components, new Set());
  const desc = [p.description, p.deprecated ? "(deprecated)" : ""]
    .filter(Boolean)
    .join(" ");
  if (desc) base.description = desc;
  // Arrays in query: accept array or comma-string (matches client.ts's buildQuery)
  if (base.type === "array" || (Array.isArray(base.type) && base.type.includes("array"))) {
    return {
      anyOf: [base, { type: "string", description: "Comma-separated list" }],
      description: base.description,
    };
  }
  return base;
}

function pickContentType(op: OpenApiOp): string | undefined {
  const content = op.requestBody?.content;
  if (!content) return undefined;
  const keys = Object.keys(content);
  if (keys.includes("application/json")) return "application/json";
  return keys[0];
}

function pickAccept(op: OpenApiOp): string | undefined {
  const r200 = (op.responses?.["200"] || op.responses?.["201"]) as
    | { content?: Record<string, unknown> }
    | undefined;
  const content = r200?.content;
  if (!content) return undefined;
  const keys = Object.keys(content);
  if (keys.includes("application/json")) return "application/json";
  return keys[0];
}

function buildDescription(
  op: OpenApiOp,
  method: string,
  path: string,
  docs: Record<string, DocEntry> | null,
): string {
  const tag = op.tags?.[0] || "AppleAds";
  const summary = (op.summary || "").trim();
  const key = `${method.toUpperCase()} ${path}`;
  const parts = [summary || key, key, `tag:${tag}`];

  // Apple Ads lists resources through POST /<resource>/query. Spell out the
  // words people actually search for so those operations are findable.
  if (/\/query$/.test(path) && method.toUpperCase() === "POST") {
    parts.push("list find search filter fetch all");
  }

  const doc = docs?.[key];
  if (doc) {
    if (doc.abstract) parts.push(doc.abstract.slice(0, 300));
    if (doc.url) parts.push(doc.url);
  }

  return parts.filter(Boolean).join(" | ").slice(0, 1024);
}

function loadDocs(): Record<string, DocEntry> | null {
  if (!existsSync(DOCS_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(DOCS_PATH, "utf8")) as {
      endpoints?: Record<string, DocEntry>;
    } & Record<string, DocEntry>;
    // docs.json wraps the map in an `endpoints` field.
    return (parsed.endpoints ?? parsed) as Record<string, DocEntry>;
  } catch {
    return null;
  }
}

function generate(): void {
  const raw = readFileSync(SPEC_PATH, "utf8");
  const spec = JSON.parse(raw) as OpenApiSpec;
  const components = spec.components?.schemas || {};
  const docs = loadDocs();

  // First pass: derive base names so we know which ones collide.
  const baseNameCounts = new Map<string, number>();
  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const method of METHODS) {
      if (!item[method]) continue;
      const base = deriveBaseName(method, path);
      baseNameCounts.set(base, (baseNameCounts.get(base) || 0) + 1);
    }
  }

  const tools: GeneratedTool[] = [];
  const usedNames = new Set<string>();

  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;

      const operationId =
        op.operationId ||
        `${method}_${path.replace(/[{}\/]/g, "_").replace(/_+/g, "_")}`;

      const base = deriveBaseName(method, path);
      const name = (baseNameCounts.get(base) || 0) > 1 ? `${base}_${method}` : base;
      if (usedNames.has(name)) {
        throw new Error(`Tool name collision after disambiguation: ${name} (${method.toUpperCase()} ${path})`);
      }
      usedNames.add(name);

      const allParams: OpenApiParam[] = [
        ...(item.parameters || []),
        ...(op.parameters || []),
      ];

      const pathParams = allParams.filter((p) => p.in === "path");
      const queryParams = allParams.filter((p) => p.in === "query");
      const headerParams = allParams.filter((p) => p.in === "header");

      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const p of pathParams) {
        properties[p.name] = paramToSchema(p, components);
        if (p.required !== false) required.push(p.name); // path params are required
      }

      for (const p of queryParams) {
        properties[p.name] = paramToSchema(p, components);
        if (p.required) required.push(p.name);
      }

      const contextHeader = headerParams.find((h) => isContextHeader(h.name));
      if (contextHeader) {
        properties["adAccountId"] = {
          type: "string",
          description: contextHeader.required
            ? "Ad account (org) ID. Sent as the X-Ap-Context header, which this operation needs. Omit it only when APPLE_ADS_AD_ACCOUNT_ID is set in the environment."
            : "Optional ad account (org) ID for the X-Ap-Context header. Falls back to APPLE_ADS_AD_ACCOUNT_ID.",
        };
        // Deliberately not in `required`: the server fills it from
        // APPLE_ADS_AD_ACCOUNT_ID when the caller leaves it out.
      }

      const hasBody = !!op.requestBody;
      const bodyRequired = !!op.requestBody?.required;
      const contentType = pickContentType(op);

      if (hasBody) {
        const bodyContent = contentType ? op.requestBody?.content?.[contentType] : undefined;
        if (bodyContent?.schema) {
          properties["body"] = {
            ...simplifySchema(bodyContent.schema, 0, components, new Set()),
            description: op.requestBody?.description || "Request body",
          };
        } else {
          properties["body"] = {
            type: "object",
            additionalProperties: true,
            description: "Request body object",
          };
        }
        if (bodyRequired) required.push("body");
      }

      // Escape hatch for advanced callers
      properties["_dryRun"] = {
        type: "boolean",
        description:
          "If true, resolve the request (method, path, params, body) without calling the Apple Ads API.",
      };

      const inputSchema: JsonSchema = {
        type: "object",
        properties,
        additionalProperties: false,
      };
      if (required.length) inputSchema.required = required;

      tools.push({
        name,
        operationId,
        method: method.toUpperCase(),
        path,
        tags: op.tags || [],
        description: buildDescription(op, method, path, docs),
        deprecated: op.deprecated || undefined,
        inputSchema,
        pathParams: pathParams.map((p) => p.name),
        queryParams: queryParams.map((p) => p.name),
        headerParams: headerParams.map((p) => p.name),
        hasBody,
        bodyRequired,
        contentType,
        accept: pickAccept(op),
      });
    }
  }

  const allNames = tools.map((t) => t.name);
  const uniqueNames = new Set(allNames);
  if (uniqueNames.size !== allNames.length) {
    const seen = new Set<string>();
    const dupes = allNames.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
    throw new Error(`Duplicate tool names generated: ${dupes.join(", ")}`);
  }

  tools.sort((a, b) => a.name.localeCompare(b.name));

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(tools, null, 2));

  const byTag: Record<string, number> = {};
  for (const t of tools) {
    const tag = t.tags[0] || "Untagged";
    byTag[tag] = (byTag[tag] || 0) + 1;
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    openapiVersion: spec.openapi,
    apiTitle: spec.info?.title,
    apiVersion: spec.info?.version,
    toolCount: tools.length,
    pathCount: Object.keys(spec.paths || {}).length,
    tagCount: Object.keys(byTag).length,
    toolsByTag: Object.fromEntries(
      Object.entries(byTag).sort((a, b) => b[1] - a[1]),
    ),
    sourceSpec: "openapi/apple-ads.openapi.json",
    note: "Regenerate with: bun run generate",
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(
    `Generated ${tools.length} tools → ${OUT_PATH}\nManifest → ${MANIFEST_PATH}`,
  );
  console.log(
    `Name collisions avoided; max name length ${Math.max(...tools.map((t) => t.name.length))}`,
  );
}

generate();
