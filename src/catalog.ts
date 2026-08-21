/**
 * In-memory catalog over generated/tools.json.
 * Used by meta-tools (search / schema / call) so the model never loads 1000+ schemas.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GeneratedTool } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export type CatalogHit = {
  name: string;
  operationId: string;
  method: string;
  path: string;
  tags: string[];
  description: string;
  hasBody: boolean;
  bodyRequired: boolean;
  pathParams: string[];
  queryParams: string[];
  deprecated?: boolean;
  score: number;
};

export type OperationSchema = {
  name: string;
  operationId: string;
  method: string;
  path: string;
  tags: string[];
  description: string;
  deprecated?: boolean;
  pathParams: string[];
  queryParams: string[];
  headerParams: string[];
  hasBody: boolean;
  bodyRequired: boolean;
  contentType?: string;
  accept?: string;
  inputSchema: Record<string, unknown>;
  notes: string[];
  /** How to invoke via ads_call */
  callHint: {
    operation: string;
    args: Record<string, string>;
  };
};

let cached: GeneratedTool[] | null = null;
let byName: Map<string, GeneratedTool> | null = null;
let byOperationId: Map<string, GeneratedTool> | null = null;

export function catalogPath(): string {
  return join(ROOT, "generated", "tools.json");
}

export function loadCatalog(): GeneratedTool[] {
  if (cached) return cached;
  const raw = readFileSync(catalogPath(), "utf8");
  const tools = JSON.parse(raw) as GeneratedTool[];
  cached = tools;
  byName = new Map(tools.map((t) => [t.name, t]));
  byOperationId = new Map(tools.map((t) => [t.operationId, t]));
  return tools;
}

export function catalogSize(): number {
  return loadCatalog().length;
}

/** Resolve by MCP tool name or OpenAPI operationId. */
export function resolveTool(operation: string): GeneratedTool | undefined {
  loadCatalog();
  const key = operation.trim();
  if (!key) return undefined;
  return byName!.get(key) ?? byOperationId!.get(key);
}

export function listTags(): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of loadCatalog()) {
    for (const tag of t.tags?.length ? t.tags : ["(untagged)"]) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9_./{}-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function scoreTool(
  t: GeneratedTool,
  query: string,
  tokens: string[],
): number {
  const name = t.name.toLowerCase();
  const op = t.operationId.toLowerCase();
  const path = t.path.toLowerCase();
  const desc = (t.description || "").toLowerCase();
  const tags = (t.tags || []).map((x) => x.toLowerCase()).join(" ");
  const method = t.method.toLowerCase();
  const blob = `${name} ${op} ${path} ${desc} ${tags} ${method}`;

  let score = 0;
  const q = query.toLowerCase().trim();

  if (!q) return 0;

  if (name === q || op === q) score += 1000;
  else if (name.startsWith(q) || op.startsWith(q)) score += 400;
  else if (name.includes(q) || op.includes(q)) score += 200;

  if (path === q) score += 300;
  else if (path.includes(q)) score += 120;

  if (tags === q || (t.tags || []).some((tg) => tg.toLowerCase() === q)) {
    score += 180;
  } else if (tags.includes(q)) {
    score += 80;
  }

  if (method === q) score += 50;

  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (name.includes(tok)) score += 40;
    if (op.includes(tok)) score += 35;
    if (path.includes(tok)) score += 25;
    if (tags.includes(tok)) score += 30;
    if (desc.includes(tok)) score += 8;
    if (method === tok) score += 15;
    // light camel/snake boundary help: "app store" ~ appStore
    if (blob.includes(tok)) score += 3;
  }

  // Apple Ads lists things through POST /<resource>/query, so favour those
  // when someone searches for a resource in general.
  if (/_query$/.test(t.name)) score += 25;
  if (t.deprecated) score -= 50;

  return score;
}

export type SearchOptions = {
  query: string;
  tag?: string;
  method?: string;
  limit?: number;
};

export function searchCatalog(opts: SearchOptions): {
  totalIndexed: number;
  returned: number;
  hits: CatalogHit[];
} {
  const tools = loadCatalog();
  const limit = Math.min(Math.max(opts.limit ?? 15, 1), 50);
  const query = (opts.query || "").trim();
  const tokens = tokenize(query);
  const methodFilter = opts.method?.trim().toUpperCase();
  const tagFilter = opts.tag?.trim().toLowerCase();

  const scored: CatalogHit[] = [];

  for (const t of tools) {
    if (methodFilter && t.method.toUpperCase() !== methodFilter) continue;
    if (
      tagFilter &&
      !(t.tags || []).some((tg) => tg.toLowerCase() === tagFilter)
    ) {
      continue;
    }

    const score = query ? scoreTool(t, query, tokens) : tagFilter || methodFilter ? 1 : 0;
    if (score <= 0) continue;

    scored.push({
      name: t.name,
      operationId: t.operationId,
      method: t.method,
      path: t.path,
      tags: t.tags || [],
      description: t.description,
      hasBody: t.hasBody,
      bodyRequired: t.bodyRequired,
      pathParams: t.pathParams,
      queryParams: t.queryParams,
      deprecated: t.deprecated,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const hits = scored.slice(0, limit);

  return {
    totalIndexed: tools.length,
    returned: hits.length,
    hits,
  };
}

function isContextHeader(h: string): boolean {
  const key = h.toLowerCase();
  return key === "x-ap-context" || key === "xapcontext";
}

export function toOperationSchema(t: GeneratedTool): OperationSchema {
  const headerParams = t.headerParams || [];
  const hasContextHeader = headerParams.some(isContextHeader);

  const args: Record<string, string> = {};
  for (const p of t.pathParams) args[p] = `<${p}>`;
  for (const q of t.queryParams.slice(0, 6)) args[q] = `<${q}>`;
  for (const h of headerParams) {
    if (isContextHeader(h)) continue;
    args[h] = `<${h}>`;
  }
  if (hasContextHeader) args.adAccountId = "<adAccountId>";
  if (t.hasBody) args.body = "<JSON body>";
  args._dryRun = "true|false";

  const notes: string[] = [];
  if (hasContextHeader) {
    notes.push(
      "Scoped to one ad account. Pass adAccountId (or set APPLE_ADS_AD_ACCOUNT_ID) — the server sends the X-Ap-Context header for you.",
    );
  }

  return {
    name: t.name,
    operationId: t.operationId,
    method: t.method,
    path: t.path,
    tags: t.tags || [],
    description: t.description,
    deprecated: t.deprecated,
    pathParams: t.pathParams,
    queryParams: t.queryParams,
    headerParams,
    hasBody: t.hasBody,
    bodyRequired: t.bodyRequired,
    contentType: t.contentType,
    accept: t.accept,
    inputSchema: t.inputSchema,
    notes,
    callHint: {
      operation: t.operationId,
      args,
    },
  };
}
