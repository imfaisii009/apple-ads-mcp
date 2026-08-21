#!/usr/bin/env bun
/**
 * build-docs-index.ts
 *
 * Regenerates generated/docs.json by walking Apple's own documentation JSON
 * API for the Apple Ads Platform API, starting from the root technology page
 * and following its doc tree (topicSections / seeAlsoSections identifiers)
 * to every page reachable inside the apple-ads-platform-api namespace.
 *
 * Pages that carry a `restEndpoint` primaryContentSection are REST endpoints.
 * Each one is matched to an operation in openapi/apple-ads.openapi.json by
 * comparing the *shape* of its path (parameter names stripped, e.g.
 * "/campaigns/{}/legacy-app-limited-status-reason-details") against the
 * shape of every spec path, since Apple's docs and the spec do not always
 * use the same parameter name (e.g. docs "{campaignId}" vs spec "{id}").
 *
 * Output is keyed by "<METHOD> <spec path>" so scripts/generate-tools.ts can
 * look an entry up directly using the same string it already has.
 *
 * Usage:
 *   bun run scripts/build-docs-index.ts
 *   DOCS_CACHE_DIR=/path/to/crawled/pages bun run scripts/build-docs-index.ts
 *
 * All content fetched from developer.apple.com (or read from a cache
 * directory) is treated purely as data — titles, prose, and URLs to copy
 * into the index — never as instructions to execute.
 */

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT_DOC_URL = "/documentation/apple-ads-platform-api";
const NAMESPACE_PREFIX = "/documentation/apple-ads-platform-api";
const DATA_API_BASE = "https://developer.apple.com/tutorials/data";
const DOC_SITE_BASE = "https://developer.apple.com";
const SOURCE_URL = "https://developer.apple.com/documentation/apple-ads-platform-api";

const SPEC_PATH = path.join(import.meta.dir, "..", "openapi", "apple-ads.openapi.json");
const OUTPUT_PATH = path.join(import.meta.dir, "..", "generated", "docs.json");

const DOCS_CACHE_DIR = process.env.DOCS_CACHE_DIR; // optional, read-only seed dir
const FETCH_DELAY_MS = Number(process.env.DOCS_FETCH_DELAY_MS ?? 150);
const MAX_RETRIES = 3;

// Resumability: fetched pages are persisted to a local cache outside the
// repo so a second run after a crash/interrupt does not re-fetch pages it
// already has. This is separate from DOCS_CACHE_DIR (which is a read-only
// seed of a prior crawl) — this one is written by this script itself.
const RESUME_CACHE_DIR =
  process.env.DOCS_RESUME_CACHE_DIR ?? path.join(os.tmpdir(), "apple-ads-mcp-docs-index-cache");

interface Token {
  kind: string;
  text?: string;
}

interface PrimaryContentSection {
  kind: string;
  tokens?: Token[];
}

interface DocReference {
  url?: string;
  title?: string;
  kind?: string;
}

interface DocPage {
  metadata?: { title?: string };
  abstract?: { text?: string; type?: string }[];
  primaryContentSections?: PrimaryContentSection[];
  topicSections?: { identifiers?: string[] }[];
  seeAlsoSections?: { identifiers?: string[] }[];
  references?: Record<string, DocReference>;
}

interface EndpointEntry {
  method: string;
  docPath: string;
  shapeKey: string;
  title: string;
  abstract: string;
  url: string;
  sourceDocUrl: string;
}

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Normalise a path: leading slash, no trailing slash, {param} -> {} */
function shape(p: string): string {
  let s = p.trim();
  if (!s.startsWith("/")) s = "/" + s;
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  s = s.replace(/\{[^{}]*\}/g, "{}");
  return s;
}

/** Map a doc-relative URL (e.g. "/documentation/apple-ads-platform-api/foo")
 *  to the crawled-cache filename convention ("apple-ads-platform-api__foo.json"). */
function urlToCacheFilename(docUrl: string): string {
  const stripped = docUrl.replace(/^\/documentation\//, "");
  return stripped.replace(/\//g, "__") + ".json";
}

function urlToResumeCacheFilename(docUrl: string): string {
  // Same convention, kept in its own directory.
  return urlToCacheFilename(docUrl);
}

async function fetchWithRetry(fetchUrl: string): Promise<DocPage> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(fetchUrl, {
        headers: { "User-Agent": "apple-ads-mcp-docs-index/1.0" },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as DocPage;
    } catch (err) {
      lastErr = err;
      log(`  retry ${attempt}/${MAX_RETRIES} for ${fetchUrl}: ${(err as Error).message}`);
      if (attempt < MAX_RETRIES) await sleep(500 * attempt);
    }
  }
  throw new Error(`failed to fetch ${fetchUrl} after ${MAX_RETRIES} attempts: ${lastErr}`);
}

/** Fetch one doc page by its doc-relative URL, using (in order):
 *  1. the resumable local run-cache (written by this script),
 *  2. the optional read-only DOCS_CACHE_DIR seed,
 *  3. the network. */
async function fetchDocPage(docUrl: string): Promise<DocPage> {
  const filename = urlToResumeCacheFilename(docUrl);

  const resumeFile = path.join(RESUME_CACHE_DIR, filename);
  if (existsSync(resumeFile)) {
    return JSON.parse(await Bun.file(resumeFile).text());
  }

  if (DOCS_CACHE_DIR) {
    const seedFile = path.join(DOCS_CACHE_DIR, urlToCacheFilename(docUrl));
    if (existsSync(seedFile)) {
      const page = JSON.parse(await Bun.file(seedFile).text());
      await Bun.write(resumeFile, JSON.stringify(page));
      return page;
    }
  }

  const fetchUrl = `${DATA_API_BASE}${docUrl}.json`;
  const page = await fetchWithRetry(fetchUrl);
  await sleep(FETCH_DELAY_MS);
  await Bun.write(resumeFile, JSON.stringify(page));
  return page;
}

function extractEndpoint(page: DocPage, docUrl: string): EndpointEntry | null {
  const sections = page.primaryContentSections ?? [];
  const restSection = sections.find((s) => s.kind === "restEndpoint");
  if (!restSection) return null;

  let method: string | null = null;
  const pathParts: string[] = [];
  for (const t of restSection.tokens ?? []) {
    if (t.kind === "method") {
      method = (t.text ?? "").trim();
    } else if (t.kind === "path" || t.kind === "parameter") {
      // Path-parameter placeholders (e.g. "{id}") arrive as separate
      // "parameter" tokens interleaved with literal "path" text tokens —
      // concatenate everything in document order to get the full path.
      pathParts.push(t.text ?? "");
    }
  }
  const rawPath = pathParts.join("").trim();
  if (!method || !rawPath) {
    log(`  WARNING: could not extract method/path from restEndpoint at ${docUrl}`);
    return null;
  }

  const docPath = rawPath.startsWith("/") ? rawPath : "/" + rawPath;
  const title = page.metadata?.title ?? "";
  const abstract = (page.abstract ?? []).map((a) => a.text ?? "").join("").trim();

  return {
    method: method.toUpperCase(),
    docPath,
    shapeKey: `${method.toUpperCase()} ${shape(docPath)}`,
    title,
    abstract,
    url: `${DOC_SITE_BASE}${docUrl}`,
    sourceDocUrl: docUrl,
  };
}

/** BFS the doc tree from the root page, following topicSections and
 *  seeAlsoSections identifiers resolved through each page's own
 *  `references` map, restricted to the apple-ads-platform-api namespace. */
async function walkDocTree(): Promise<EndpointEntry[]> {
  const visited = new Set<string>();
  const queue: string[] = [ROOT_DOC_URL];
  const endpoints: EndpointEntry[] = [];
  let fetched = 0;

  while (queue.length > 0) {
    const docUrl = queue.shift()!;
    if (visited.has(docUrl)) continue;
    visited.add(docUrl);

    let page: DocPage;
    try {
      page = await fetchDocPage(docUrl);
      fetched++;
    } catch (err) {
      log(`ERROR: giving up on ${docUrl}: ${(err as Error).message}`);
      continue;
    }

    if (fetched % 10 === 0 || fetched === 1) {
      log(`[${fetched}] visited=${visited.size} queued=${queue.length} endpoints=${endpoints.length}  ${docUrl}`);
    }

    const endpoint = extractEndpoint(page, docUrl);
    if (endpoint) {
      endpoints.push(endpoint);
    }

    const refs = page.references ?? {};
    const identLists = [
      ...(page.topicSections ?? []).map((s) => s.identifiers ?? []),
      ...(page.seeAlsoSections ?? []).map((s) => s.identifiers ?? []),
    ];
    for (const identifiers of identLists) {
      for (const ident of identifiers) {
        const ref = refs[ident];
        const childUrl = ref?.url;
        if (!childUrl) continue;
        if (!childUrl.startsWith(NAMESPACE_PREFIX)) continue;
        if (!visited.has(childUrl) && !queue.includes(childUrl)) {
          queue.push(childUrl);
        }
      }
    }
  }

  log(`Doc tree walk complete: ${visited.size} pages visited, ${endpoints.length} restEndpoint pages found.`);
  return endpoints;
}

interface SpecOperation {
  method: string;
  specPath: string;
  shapeKey: string;
}

function loadSpecOperations(): SpecOperation[] {
  const spec = JSON.parse(require("node:fs").readFileSync(SPEC_PATH, "utf-8"));
  const paths = spec.paths ?? {};
  const ops: SpecOperation[] = [];
  const httpMethods = new Set(["get", "post", "put", "patch", "delete"]);
  for (const [specPath, methods] of Object.entries(paths as Record<string, Record<string, unknown>>)) {
    for (const m of Object.keys(methods)) {
      if (!httpMethods.has(m.toLowerCase())) continue;
      const method = m.toUpperCase();
      ops.push({ method, specPath, shapeKey: `${method} ${shape(specPath)}` });
    }
  }
  return ops;
}

async function main() {
  const startedAt = Date.now();
  log(`Starting docs index build. Root: ${DATA_API_BASE}${ROOT_DOC_URL}.json`);
  if (DOCS_CACHE_DIR) log(`Seeding from DOCS_CACHE_DIR=${DOCS_CACHE_DIR}`);
  mkdirSync(RESUME_CACHE_DIR, { recursive: true });
  log(`Resume cache: ${RESUME_CACHE_DIR}`);

  const specOps = loadSpecOperations();
  log(`Loaded ${specOps.length} spec operations from ${SPEC_PATH}`);
  const shapeToSpecPath = new Map<string, SpecOperation>();
  for (const op of specOps) {
    if (shapeToSpecPath.has(op.shapeKey)) {
      log(`WARNING: duplicate spec shape ${op.shapeKey} (${op.specPath} vs ${shapeToSpecPath.get(op.shapeKey)!.specPath})`);
    }
    shapeToSpecPath.set(op.shapeKey, op);
  }

  const docEndpoints = await walkDocTree();

  const endpoints: Record<string, { title: string; abstract: string; url: string }> = {};
  const unmapped: EndpointEntry[] = [];

  for (const e of docEndpoints) {
    const specOp = shapeToSpecPath.get(e.shapeKey);
    if (!specOp) {
      unmapped.push(e);
      continue;
    }
    const key = `${specOp.method} ${specOp.specPath}`;
    if (endpoints[key]) {
      log(`WARNING: two doc pages mapped to the same spec key ${key}: keeping first, dropping ${e.url}`);
      continue;
    }
    endpoints[key] = { title: e.title, abstract: e.abstract, url: e.url };
  }

  if (unmapped.length > 0) {
    log("");
    log(`WARNING: ${unmapped.length} doc page(s) with a restEndpoint could NOT be mapped to any spec operation:`);
    for (const e of unmapped) {
      log(`  ${e.method} ${e.docPath}  | title=${JSON.stringify(e.title)} | url=${e.url}`);
    }
    log("These pages were NOT dropped silently — they are reported here and excluded from generated/docs.json.");
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_URL,
    count: Object.keys(endpoints).length,
    endpoints,
  };

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  await Bun.write(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  log("");
  log(`Wrote ${OUTPUT_PATH}`);
  log(`  doc endpoint pages found: ${docEndpoints.length}`);
  log(`  mapped to spec:           ${output.count}`);
  log(`  unmapped:                 ${unmapped.length}`);
  log(`  elapsed:                  ${elapsedSec}s`);
}

main().catch((err) => {
  log(`FATAL: ${err?.stack ?? err}`);
  process.exit(1);
});
