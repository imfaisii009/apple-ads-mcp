#!/usr/bin/env bun
/**
 * Offline smoke test: generate → catalog → meta-tools → server boot → optional live call.
 *
 * Live call only if APPLE_ADS_CLIENT_ID + APPLE_ADS_TEAM_ID + APPLE_ADS_KEY_ID +
 * (APPLE_ADS_PRIVATE_KEY_PATH or APPLE_ADS_PRIVATE_KEY) are set.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GeneratedTool } from "../src/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function runGenerate(): Promise<void> {
  const proc = Bun.spawn(["bun", "run", "scripts/generate-tools.ts"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  assert(code === 0, `generate failed: exit ${code}`);
}

async function mcpBootCheck(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", "src/index.ts"], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });

    const bootTimer = setTimeout(() => {
      child.kill();
      if (err.includes("ready") || err.includes("meta-tools")) {
        resolve(err);
      } else {
        reject(
          new Error(
            `server boot timeout. stderr=${err.slice(0, 500)}`,
          ),
        );
      }
    }, 5000);

    child.on("error", reject);
    child.stderr.once("data", () => {
      setTimeout(() => {
        clearTimeout(bootTimer);
        child.kill();
        resolve(err);
      }, 200);
    });
  });
}

async function liveMeCheck(): Promise<void> {
  const { adsRequest } = await import("../src/client.js");
  const res = await adsRequest({ method: "GET", path: "/me" });
  console.log("live GET /me status", res.status);
  if (res.status >= 400) {
    console.log(JSON.stringify(res.body, null, 2).slice(0, 800));
    throw new Error(`live call failed: ${res.status}`);
  }
}

async function main() {
  console.log("== generate ==");
  await runGenerate();

  const toolsPath = join(ROOT, "generated", "tools.json");
  const manifestPath = join(ROOT, "generated", "manifest.json");
  assert(existsSync(toolsPath), "tools.json missing");
  assert(existsSync(manifestPath), "manifest.json missing");

  const tools = JSON.parse(readFileSync(toolsPath, "utf8")) as GeneratedTool[];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    toolCount: number;
    apiVersion: string;
  };

  console.log("== inventory ==");
  console.log({
    toolCount: tools.length,
    manifestCount: manifest.toolCount,
    apiVersion: manifest.apiVersion,
  });
  assert(tools.length === manifest.toolCount, "manifest/tool count mismatch");
  assert(tools.length === 99, `expected 99 tools, got ${tools.length}`);

  const names = new Set(tools.map((t) => t.name));
  assert(names.size === tools.length, "duplicate tool names");
  for (const t of tools) {
    assert(t.name.length <= 64, `name too long: ${t.name}`);
    assert(t.method && t.path, `missing method/path: ${t.operationId}`);
    assert(t.inputSchema?.type === "object", `bad schema: ${t.name}`);
    assert(Array.isArray(t.pathParams), `pathParams not array: ${t.name}`);
    assert(Array.isArray(t.queryParams), `queryParams not array: ${t.name}`);
    assert(Array.isArray(t.headerParams), `headerParams not array: ${t.name}`);
    assert(typeof t.hasBody === "boolean", `hasBody not boolean: ${t.name}`);
    assert(typeof t.bodyRequired === "boolean", `bodyRequired not boolean: ${t.name}`);
  }

  const mustInclude = [
    "campaigns_query",
    "campaigns_create",
    "adgroups_query",
    "keywords_bulkCreate",
    "negativeKeywords_query",
    "reports_appsCampaignsQuery",
    "creatives_query",
    "assets_upload",
    "me_list",
    "acls_list",
  ];
  for (const n of mustInclude) {
    assert(names.has(n), `missing expected tool name: ${n}`);
  }

  console.log("== catalog meta-router ==");
  const {
    catalogSize,
    listTags,
    resolveTool,
    searchCatalog,
    toOperationSchema,
  } = await import("../src/catalog.ts");

  assert(catalogSize() === tools.length, "catalog size mismatch");

  const campaignSearch = searchCatalog({ query: "list campaigns", limit: 10 });
  assert(campaignSearch.returned > 0, "search 'list campaigns' returned 0");
  assert(
    campaignSearch.hits.some((h) => h.name === "campaigns_query" || h.operationId === "campaignsQueryPost"),
    "search 'list campaigns' should rank campaigns_query",
  );
  console.log(
    "search list campaigns top:",
    campaignSearch.hits.slice(0, 3).map((h) => h.name),
  );

  const keywordSearch = searchCatalog({ query: "keyword bids", limit: 10 });
  assert(keywordSearch.returned > 0, "search 'keyword bids' returned 0");

  const reportSearch = searchCatalog({ query: "impression share report", limit: 10 });
  assert(reportSearch.returned > 0, "search 'impression share report' returned 0");

  const createGet = searchCatalog({
    query: "campaigns",
    method: "GET",
    limit: 10,
  });
  assert(
    createGet.hits.every((h) => h.method === "GET"),
    "method filter failed",
  );
  assert(
    createGet.hits.some((h) => h.name === "campaigns_get"),
    "campaigns GET should include campaigns_get",
  );

  const tagOnly = searchCatalog({ query: "", tag: "Campaigns", limit: 10 });
  assert(tagOnly.returned > 0, "tag-only search failed");
  assert(
    tagOnly.hits.every((h) => h.tags.includes("Campaigns")),
    "tag filter failed",
  );

  const tags = listTags();
  assert(tags.length >= 10, `expected several tags, got ${tags.length}`);
  assert(
    tags.some((t) => t.tag === "Campaigns" && t.count > 0),
    "Campaigns tag missing",
  );

  // resolveTool by name and by operationId
  const byName = resolveTool("campaigns_query");
  assert(byName, "resolveTool by name (campaigns_query)");
  assert(byName!.operationId === "campaignsQueryPost", "resolveTool by name returned wrong op");

  const byOpId = resolveTool("campaignsQueryPost");
  assert(byOpId, "resolveTool by operationId (campaignsQueryPost)");
  assert(byOpId!.name === "campaigns_query", "resolveTool by operationId returned wrong tool");

  const schema = toOperationSchema(byName!);
  assert(schema.inputSchema?.type === "object", "schema missing");
  assert(schema.callHint.operation === "campaignsQueryPost", "callHint");
  assert(schema.method === "POST", "schema method");

  console.log("== formatToolResult ==");
  const { formatToolResult } = await import("../src/client.js");
  const fake = formatToolResult({
    status: 200,
    headers: {},
    body: { ok: true },
    contentType: "application/json",
  });
  assert(!fake.isError && fake.text.includes("ok"), "formatToolResult failed");

  console.log("== dry-run resolution (no network) ==");
  // campaigns_query has no path params, a query-string `limit`-style body is not
  // applicable here, so use campaigns_get (path param) and adgroups_query (query params)
  // to prove pathParams/queryParams resolve correctly with zero network calls.
  const campaignsGet = resolveTool("campaigns_get");
  assert(campaignsGet, "campaigns_get");
  assert(campaignsGet!.pathParams.includes("id"), "campaigns_get needs id path param");
  assert(campaignsGet!.headerParams.includes("X-Ap-Context"), "campaigns_get needs X-Ap-Context header");
  {
    // Simulate the same dry-run resolution src/index.ts's executeOperation performs
    // (pathParams -> path template fill), using only pure catalog data — no adsRequest call.
    const args = { id: "12345", adAccountId: "999", _dryRun: true } as Record<string, unknown>;
    const pathParams: Record<string, string> = {};
    for (const p of campaignsGet!.pathParams) {
      if (args[p] !== undefined) pathParams[p] = String(args[p]);
    }
    assert(pathParams.id === "12345", "dry-run path param resolution failed");
    const resolvedPath = campaignsGet!.path.replace(/\{([^}]+)\}/g, (_, n: string) => pathParams[n] ?? "");
    assert(resolvedPath === "/campaigns/12345", `dry-run resolved path wrong: ${resolvedPath}`);
    assert(campaignsGet!.method === "GET", "dry-run method wrong");
  }

  const advertiserResourcesList = resolveTool("advertiserResources_list");
  assert(advertiserResourcesList, "advertiserResources_list");
  assert(advertiserResourcesList!.method === "GET", "advertiserResources_list method");
  assert(advertiserResourcesList!.pathParams.length === 0, "advertiserResources_list should have no path params");

  // keywords_bulkCreate has a JSON body
  const bulkCreate = resolveTool("keywords_bulkCreate");
  assert(bulkCreate, "keywords_bulkCreate");
  assert(bulkCreate!.hasBody, "keywords_bulkCreate should have a body");
  assert(bulkCreate!.contentType === "application/json", "keywords_bulkCreate contentType");

  // assets_upload uses multipart/form-data
  const upload = resolveTool("assets_upload");
  assert(upload, "assets_upload");
  assert(upload!.contentType === "multipart/form-data", "assets_upload should be multipart/form-data");

  console.log("== server boot ==");
  const bootLog = await mcpBootCheck();
  assert(
    bootLog.includes("meta-tools") || bootLog.includes("ready"),
    `unexpected boot log: ${bootLog.slice(0, 300)}`,
  );
  console.log("server ready line:", bootLog.trim().split("\n").pop());

  const hasLive =
    process.env.APPLE_ADS_CLIENT_ID &&
    process.env.APPLE_ADS_TEAM_ID &&
    process.env.APPLE_ADS_KEY_ID &&
    (process.env.APPLE_ADS_PRIVATE_KEY_PATH || process.env.APPLE_ADS_PRIVATE_KEY);

  if (hasLive) {
    console.log("== live GET /me ==");
    await liveMeCheck();

    // live via catalog-resolved operation
    const { adsRequest } = await import("../src/client.js");
    const op = resolveTool("me_list");
    assert(op, "me_list for live");
    const res = await adsRequest({ method: op!.method, path: op!.path });
    assert(res.status < 400, `meta-style live call status ${res.status}`);
    console.log("meta-style live call ok", res.status);
  } else {
    console.log(
      "== live skipped (set APPLE_ADS_CLIENT_ID, APPLE_ADS_TEAM_ID, APPLE_ADS_KEY_ID, APPLE_ADS_PRIVATE_KEY_PATH to enable) ==",
    );
  }

  console.log("\nSMOKE OK", {
    tools: tools.length,
    metaTools: ["ads_search", "ads_schema", "ads_call", "ads_tags"],
    apiVersion: manifest.apiVersion,
    live: !!hasLive,
  });
}

main().catch((e) => {
  console.error("SMOKE FAILED", e);
  process.exit(1);
});
