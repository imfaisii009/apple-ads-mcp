#!/usr/bin/env bun
/**
 * dp-ads — Apple Ads Platform API MCP server
 *
 * Default surface: 4 meta-tools over the full OpenAPI catalog (search → schema → call).
 * Set APPLE_ADS_EXPOSE_ALL_TOOLS=1 to register every generated operation as its own MCP tool
 * (very expensive for LLM context; only for debugging).
 *
 * Auth: OAuth client-credentials JWT from APPLE_ADS_CLIENT_ID + APPLE_ADS_TEAM_ID + APPLE_ADS_KEY_ID + APPLE_ADS_PRIVATE_KEY_PATH (.p8)
 * Credentials come from the environment only — nothing is bundled in this package.
 *
 * Transport: stdio (Claude Code / Claude Desktop)
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  adsRequest,
  contextHeaderValue,
  defaultAdAccountId,
  fillPath,
  formatToolResult,
} from "./client.js";
import {
  catalogSize,
  listTags,
  loadCatalog,
  resolveTool,
  searchCatalog,
  toOperationSchema,
} from "./catalog.js";
import type { GeneratedTool } from "./types.js";

const EXPOSE_ALL =
  process.env.APPLE_ADS_EXPOSE_ALL_TOOLS === "1" ||
  process.env.APPLE_ADS_EXPOSE_ALL_TOOLS === "true";

function jsonText(data: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    isError,
  };
}

function isContextHeader(h: string): boolean {
  const key = h.toLowerCase();
  return key === "x-ap-context" || key === "xapcontext";
}

function executeOperation(
  tool: GeneratedTool,
  args: Record<string, unknown>,
) {
  const pathParams: Record<string, string> = {};
  for (const p of tool.pathParams) {
    if (args[p] !== undefined && args[p] !== null) {
      pathParams[p] = String(args[p]);
    }
  }

  const query: Record<string, unknown> = {};
  for (const q of tool.queryParams) {
    if (args[q] !== undefined) query[q] = args[q];
  }

  const headers: Record<string, string> = {};
  for (const h of tool.headerParams) {
    if (isContextHeader(h)) continue;
    if (args[h] !== undefined && args[h] !== null) {
      headers[h] = String(args[h]);
    }
  }

  const adAccountIdRaw = args.adAccountId ?? args.orgId ?? args.xApContext;
  const adAccountId =
    adAccountIdRaw !== undefined && adAccountIdRaw !== null
      ? String(adAccountIdRaw)
      : undefined;
  const resolvedAdAccountId = adAccountId || defaultAdAccountId();

  const body = tool.hasBody ? args.body : undefined;
  const dryRun = args._dryRun === true;

  if (dryRun) {
    // Resolve the path the same way a real call would, so a dry run catches
    // a missing path param instead of quietly passing.
    const resolvedPath = fillPath(tool.path, pathParams);
    return jsonText({
      dryRun: true,
      operationId: tool.operationId,
      method: tool.method,
      path: tool.path,
      resolvedPath,
      pathParams,
      query,
      headers,
      body: body ?? null,
      contentType: tool.contentType,
      accept: tool.accept || "application/json",
      adAccountId: resolvedAdAccountId || null,
      xApContext: resolvedAdAccountId
        ? contextHeaderValue(resolvedAdAccountId)
        : null,
    });
  }

  return adsRequest({
    method: tool.method,
    path: tool.path,
    pathParams,
    query,
    body,
    contentType: tool.contentType,
    accept: tool.accept,
    adAccountId,
    headers,
  }).then((res) => {
    const { text, isError } = formatToolResult(res);
    return {
      content: [{ type: "text" as const, text }],
      isError,
    };
  });
}

const metaTools: Tool[] = [
  {
    name: "ads_search",
    description:
      "Search the Apple Ads Platform API catalog (full OpenAPI surface). Returns matching operations with method, path, tags, and param names — not full JSON Schemas. Use before ads_schema / ads_call. Examples: \"list campaigns\", \"create ad group\", \"keyword bids\", \"impression share report\", \"negative keywords\", \"creatives\", path fragments like \"/campaigns\".",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Free-text search over operationId, name, path, tags, method, description. Optional if tag or method is set.",
        },
        tag: {
          type: "string",
          description:
            "Optional exact OpenAPI tag filter (e.g. Campaigns, AdGroups, Keywords)",
        },
        method: {
          type: "string",
          description: "Optional HTTP method filter: GET, POST, PUT, DELETE",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Max hits (default 15, max 50)",
        },
      },
    },
  },
  {
    name: "ads_schema",
    description:
      "Return the full input JSON Schema and call hints for one Apple Ads operation. Pass operationId or tool name from ads_search (e.g. campaigns_find).",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "OpenAPI operationId or generated tool name",
        },
      },
      required: ["operation"],
    },
  },
  {
    name: "ads_call",
    description:
      "Execute one Apple Ads Platform API operation. Prefer ads_search → ads_schema first. Pass path params and query params as top-level fields; JSON body as `body`. Pass adAccountId (or set APPLE_ADS_AD_ACCOUNT_ID) to scope the request to one ad account. Set _dryRun:true to resolve the request without calling Apple.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "OpenAPI operationId or generated tool name",
        },
        args: {
          type: "object",
          description:
            "Path params, query params, optional body, optional _dryRun. AdditionalProperties allowed.",
          additionalProperties: true,
        },
        _dryRun: {
          type: "boolean",
          description:
            "If true, do not call Apple — return resolved request only (merged into args)",
        },
      },
      required: ["operation"],
    },
  },
  {
    name: "ads_tags",
    description:
      "List OpenAPI resource tags and operation counts. Use to narrow ads_search with the tag filter.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 300,
          description: "Max tags to return (default all, sorted by count)",
        },
      },
    },
  },
];

function allOperationTools(): Tool[] {
  return loadCatalog().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Tool["inputSchema"],
  }));
}

const server = new Server(
  {
    name: "dp-ads",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (EXPOSE_ALL) {
    return { tools: [...metaTools, ...allOperationTools()] };
  }
  return { tools: metaTools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments || {}) as Record<string, unknown>;

  try {
    if (name === "ads_search") {
      const query = String(args.query ?? "");
      if (!query.trim() && !args.tag && !args.method) {
        return jsonText(
          {
            error: "query is required (or pass tag/method with query)",
            hint: "Example: { \"query\": \"list campaigns\" } or { \"query\": \"keywords\", \"method\": \"GET\" }",
          },
          true,
        );
      }
      const result = searchCatalog({
        query,
        tag: args.tag !== undefined ? String(args.tag) : undefined,
        method: args.method !== undefined ? String(args.method) : undefined,
        limit:
          typeof args.limit === "number"
            ? args.limit
            : args.limit !== undefined
              ? Number(args.limit)
              : undefined,
      });
      return jsonText({
        ...result,
        next: "Call ads_schema with hits[].operationId, then ads_call.",
      });
    }

    if (name === "ads_schema") {
      const operation = String(args.operation ?? "");
      const tool = resolveTool(operation);
      if (!tool) {
        return jsonText(
          {
            error: `Unknown operation: ${operation}`,
            hint: "Use ads_search to find a valid operationId.",
            totalIndexed: catalogSize(),
          },
          true,
        );
      }
      return jsonText(toOperationSchema(tool));
    }

    if (name === "ads_call") {
      const operation = String(args.operation ?? "");
      const tool = resolveTool(operation);
      if (!tool) {
        return jsonText(
          {
            error: `Unknown operation: ${operation}`,
            hint: "Use ads_search to find a valid operationId.",
            totalIndexed: catalogSize(),
          },
          true,
        );
      }
      const callArgs = {
        ...((args.args as Record<string, unknown> | undefined) ?? {}),
      };
      // Allow top-level convenience fields (except control keys)
      for (const [k, v] of Object.entries(args)) {
        if (k === "operation" || k === "args") continue;
        if (callArgs[k] === undefined) callArgs[k] = v;
      }
      if (args._dryRun === true) callArgs._dryRun = true;

      try {
        return await executeOperation(tool, callArgs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonText(
          {
            error: message,
            operationId: tool.operationId,
            method: tool.method,
            path: tool.path,
          },
          true,
        );
      }
    }

    if (name === "ads_tags") {
      const tags = listTags();
      const limit =
        typeof args.limit === "number"
          ? args.limit
          : args.limit !== undefined
            ? Number(args.limit)
            : tags.length;
      return jsonText({
        totalTags: tags.length,
        totalOperations: catalogSize(),
        tags: tags.slice(0, Math.min(Math.max(limit, 1), 300)),
      });
    }

    // Legacy / debug: direct operation tool name when APPLE_ADS_EXPOSE_ALL_TOOLS is on
    const direct = resolveTool(name);
    if (direct) {
      try {
        return await executeOperation(direct, args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonText(
          {
            error: message,
            operationId: direct.operationId,
            method: direct.method,
            path: direct.path,
          },
          true,
        );
      }
    }

    return jsonText(
      {
        error: `Unknown tool: ${name}`,
        hint: EXPOSE_ALL
          ? `Use ads_search / ads_schema / ads_call, or a generated operation name. Catalog size: ${catalogSize()}.`
          : `This server exposes meta-tools only (ads_search, ads_schema, ads_call, ads_tags) over ${catalogSize()} Apple Ads operations. Set APPLE_ADS_EXPOSE_ALL_TOOLS=1 to register every operation as its own tool.`,
      },
      true,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonText({ error: message }, true);
  }
});

async function main() {
  // Warm catalog so first search is instant and boot log is accurate
  const n = catalogSize();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only — stdout is MCP
  if (EXPOSE_ALL) {
    console.error(
      `dp-ads ready: meta-tools + ${n} operation tools (APPLE_ADS_EXPOSE_ALL_TOOLS=1)`,
    );
  } else {
    console.error(
      `dp-ads ready: 4 meta-tools over ${n} Apple Ads operations (search/schema/call/tags)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
