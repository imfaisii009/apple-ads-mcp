<div align="center">

# Apple Ads MCP Server

**The Apple Ads Platform API, as an MCP server.**
99 operations across every documented resource, exposed to Claude Code, Claude Desktop, Cursor and any other Model Context Protocol client through **4 token-efficient tools**.

[![CI](https://img.shields.io/github/actions/workflow/status/imfaisii/apple-ads-mcp/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/imfaisii/apple-ads-mcp/actions/workflows/ci.yml)
[![Model Context Protocol](https://img.shields.io/badge/Model_Context_Protocol-server-0A7CFF?style=flat-square)](https://modelcontextprotocol.io)
[![Apple Ads Platform API](https://img.shields.io/badge/Apple_Ads_Platform_API-spec_109-000000?style=flat-square&logo=apple&logoColor=white)](https://developer.apple.com/documentation/apple-ads-platform-api)
[![99 operations](https://img.shields.io/badge/operations-99-1f6feb?style=flat-square)](#what-you-can-do-with-it)
[![4 MCP tools](https://img.shields.io/badge/MCP_tools-4-2ea043?style=flat-square)](#the-four-tools)
[![Bun](https://img.shields.io/badge/Bun-1.1+-f472b6?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

</div>

---

`apple-ads-mcp` is an open source **Model Context Protocol (MCP) server for the Apple Ads Platform API** — the API behind Apple Search Ads and Apple Maps brand ads. Install it once and your AI agent can read and write campaigns, ad groups, keywords, creatives, budgets, reports and everything else Apple exposes for your ad accounts.

The catalog is generated from `openapi/apple-ads.openapi.json`, reconstructed from Apple's official Node client (`apple/apple-ads-platform-api-node`, spec tag 109) and cross-checked endpoint by endpoint against Apple's published documentation.

> **No credentials live in this repository.** You supply your own Apple Ads API credentials at runtime through environment variables. Nothing is bundled, logged or transmitted anywhere except Apple.

### Table of contents

- [Why 4 tools instead of 99](#why-4-tools-instead-of-99)
- [What you can do with it](#what-you-can-do-with-it)
- [Requirements](#requirements)
- [Getting your credentials](#getting-your-credentials)
- [Install and configure](#install-and-configure)
- [The four tools](#the-four-tools)
- [A worked example](#a-worked-example)
- [Ad account scoping](#ad-account-scoping)
- [Query, pagination and sorting](#query-pagination-and-sorting)
- [Reports](#reports)
- [Errors and rate limits](#errors-and-rate-limits)
- [Dry run](#dry-run)
- [Environment variables](#environment-variables)
- [How the catalog is generated](#how-the-catalog-is-generated)
- [Escape hatch: every operation as its own tool](#escape-hatch-every-operation-as-its-own-tool)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## Why 4 tools instead of 99

Registering all 99 Apple Ads operations as individual MCP tools means dumping 99 full JSON Schemas into the model's context window before it does any real work. Most of that budget is wasted on operations the agent never calls in a given conversation.

This server keeps the full catalog **internal** and exposes a small, stable surface on top of it:

```text
ads_search  →  find operations           (names, methods, paths, tags — no schemas)
ads_schema  →  describe one operation    (full input JSON Schema + call hint)
ads_call    →  execute one operation     (real request, or _dryRun)
ads_tags    →  list resource tags        (with operation counts, to narrow search)
```

The agent pays for exactly the schema it is about to use, and nothing else. A typical search → schema → call flow costs a few thousand tokens instead of the tens of thousands it would take to load every schema up front — and it loses no coverage, because the full 99-operation catalog is still reachable through `ads_search` and `ads_call`.

---

## What you can do with it

All 99 operations across 28 resource tags. Run `ads_tags` at any time for the live, exact list with counts.

- **Campaigns** — create, read, update, delete, query by filter/sort/pagination (`Campaigns`)
- **Ad groups** — create, read, update, delete, query (`AdGroups`)
- **Keywords and negative keywords** — create, read, update, delete, query, plus bulk create/update for both (`Keywords`, `NegativeKeywords`)
- **Ads** — create, read, update, delete, query (`Ads`)
- **Creatives** — create, read, update, delete, query (`Creatives`)
- **Assets** — upload, read, delete, query — the images and video used in creatives and Apple Maps brand ads (`Assets`)
- **Product pages** — read custom product pages and their locale details, query (`ProductPages`)
- **Shared budgets** — create, read, update, delete, query — budgets shared across multiple campaigns (`SharedBudgets`)
- **Geo and locations** — search and query targetable locations, manage location groups (`Locations`, `LocationGroups`, `Search`)
- **Apple Maps brand ads** — business brands and business categories for Maps-based campaigns (`Brands`, `Categories`)
- **Reports** — app and business-brand performance reports by campaign, ad group, ad, keyword and search term (`Reports`)
- **Insights** — impression share and search-term popularity (`Insights`)
- **Recommendations** — daily budget and target CPA recommendations: query, apply, dismiss (`Recommendations`)
- **Suggestions** — keyword, phrase, category and target-CPA suggestions for building out campaigns (`Suggestions`)
- **Change history** — audit summaries and change details for an ad account (`ChangeHistory`)
- **Account and access management** — ad accounts, org info, user ACLs, the authenticated caller's identity, advertiser resources (`AdAccounts`, `Orgs`, `Acls`, `Me`, `AdvertiserResources`)
- **App search, eligibility and metadata** — search the App Store catalog, check app-store-ad eligibility, look up app locale details, supported languages, and rejection reasons for apps and brands (`Apps`, `Search`, `Eligibilities`, `Metadata`, `RejectionReasons`)

---

## Requirements

- [**Bun**](https://bun.sh) 1.1 or newer
- An **Apple Ads account with API access** — a client ID, team ID, key ID and a private key, from the Apple Ads UI
- An MCP client that speaks stdio: Claude Code, Claude Desktop, Cursor, or your own agent

---

## Getting your credentials

1. Sign in at [ads.apple.com](https://ads.apple.com).
2. Generate an EC private key locally (Apple never sees the private key itself):
   ```bash
   openssl ecparam -genkey -name prime256v1 -noout -out private-key.pem
   openssl ec -in private-key.pem -pubout -out public-key.pem
   ```
3. Go to **Account Settings → API**, paste the contents of `public-key.pem` (including the `BEGIN`/`END` lines) into the Public Key field, and save.
4. After saving, the page shows your credentials block: a **Client ID**, a **Team ID**, and a **Key ID**. Copy all three.
5. Keep `private-key.pem` outside your repository, for example `~/.apple-ads/private-key.pem`, and `chmod 600` it.

This server takes it from there: it signs the ES256 client-secret JWT, exchanges it for an access token, and caches the token in memory. See [Ad account scoping](#ad-account-scoping) for how to find your ad account ID once you have credentials.

---

## Install and configure

```bash
git clone https://github.com/imfaisii/apple-ads-mcp.git
cd apple-ads-mcp
bun install
bun run smoke     # offline catalog check + server boot — no credentials needed
```

Copy `.env.example` to `.env` and fill in your values, or pass them directly in your MCP client's config. Any client that launches a stdio MCP server works the same way — `mcp.example.json` in this repo is a ready-to-copy template:

```json
{
  "mcpServers": {
    "apple-ads": {
      "command": "bun",
      "args": [
        "run",
        "/ABS/PATH/to/apple-ads-mcp/src/index.ts"
      ],
      "env": {
        "APPLE_ADS_CLIENT_ID": "SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "APPLE_ADS_TEAM_ID": "SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "APPLE_ADS_KEY_ID": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "APPLE_ADS_PRIVATE_KEY_PATH": "/ABS/PATH/to/private-key.pem",
        "APPLE_ADS_AD_ACCOUNT_ID": "1234567"
      }
    }
  }
}
```

**Claude Code** — register it globally:

```bash
claude mcp add apple-ads \
  -s user \
  -t stdio \
  -e APPLE_ADS_CLIENT_ID=SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
  -e APPLE_ADS_TEAM_ID=SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
  -e APPLE_ADS_KEY_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
  -e APPLE_ADS_PRIVATE_KEY_PATH=$HOME/.apple-ads/private-key.pem \
  -e APPLE_ADS_AD_ACCOUNT_ID=1234567 \
  -- bun run /ABS/PATH/to/apple-ads-mcp/src/index.ts

claude mcp get apple-ads
```

Start a new session. The tools appear as `mcp__apple-ads__ads_search`, `…ads_schema`, `…ads_call` and `…ads_tags`.

**Claude Desktop** — add the same `mcpServers` block shown above to `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Restart Claude Desktop after editing it.

**Cursor** — `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project), same `mcpServers` block.

**Your own agent** — run `bun run src/index.ts` and speak MCP over stdio. It will look like it is hanging in a raw terminal; that is a stdio server waiting for a client, and it is correct.

---

## The four tools

### `ads_search` — find the right operation

Free-text search over operationId, name, path, tags, method and description. Returns ranked hits without the JSON Schemas.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | string | optional* | Free text, e.g. `"list campaigns"`, `"create ad group"`, `"keyword bids"`, `"impression share report"` |
| `tag` | string | optional* | Exact resource tag filter, e.g. `Campaigns`, `AdGroups`, `Keywords` |
| `method` | string | optional | `GET`, `POST`, `PUT`, `DELETE` |
| `limit` | integer | optional | Max hits, default `15`, max `50` |

\* At least one of `query`, `tag` or `method`.

```jsonc
{ "query": "create campaign", "method": "POST", "limit": 5 }
```

### `ads_schema` — describe one operation

Returns the operation's full input JSON Schema, its path/query/header parameter lists, and a `callHint` showing how to invoke it.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `operation` | string | **yes** | OperationId or generated tool name, e.g. `campaigns_create` |

```jsonc
{ "operation": "campaigns_create" }
```

### `ads_call` — execute the operation

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `operation` | string | **yes** | OperationId or generated tool name |
| `args` | object | optional | Path params, query params, `body`, `adAccountId`, `_dryRun`. Additional properties allowed |
| `_dryRun` | boolean | optional | Resolve method/path/query/body **without** calling Apple |

Path and query fields, `adAccountId`, and `_dryRun` all work either nested inside `args` or as top-level keys next to `operation`.

```jsonc
// query campaigns
{
  "operation": "campaigns_query",
  "args": {
    "body": {
      "filters": [{ "field": "status", "operator": "EQUALS", "value": "ENABLED" }],
      "pagination": { "pageSize": 10, "fetchTotalCount": true }
    }
  }
}

// create a campaign
{
  "operation": "campaigns_create",
  "args": {
    "body": {
      "name": "Away Finder — Brand",
      "billingEvent": "TAPS",
      "startTime": "2026-09-01T00:00:00Z",
      "promotedObjectType": "APPSTORE_APP",
      "promotedObjectId": "1234567890",
      "status": "ENABLED",
      "dailyBudget": { "value": { "amount": "50.00", "currency": "USD" } }
    }
  }
}
```

### `ads_tags` — orient inside the API

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `limit` | integer | optional | Max tags, default all 28, sorted by operation count |

```jsonc
{}
```

---

## A worked example

A full flow from zero context to a real call: discover the ad account, find the operation, read its schema, then run it.

```text
1. ads_call     { operation: "acls_list" }
   → { result: { acls: [ { adAccount: { id: 123456789, name: "Away Finder" }, roles: ["Admin"] } ] } }
   Use adAccount.id as the ad account for every scoped call below.

2. ads_search   { query: "list campaigns" }
   → hits: [ { name: "campaigns_query", operationId: "campaignsQueryPost", method: "POST", path: "/campaigns/query", tags: ["Campaigns"] }, ... ]

3. ads_schema   { operation: "campaigns_query" }
   → full inputSchema (adAccountId, body.filters, body.sorting, body.pagination) + callHint

4. ads_call     {
     operation: "campaigns_query",
     args: {
       adAccountId: "123456789",
       body: {
         filters: [{ field: "status", operator: "EQUALS", value: "ENABLED" }],
         sorting: [{ field: "name", order: "ASC" }],
         pagination: { pageSize: 10, fetchTotalCount: true }
       }
     }
   }
   → { status: 200, body: { result: [ { id: 542370549, name: "Away Finder — Brand", status: "ENABLED", ... } ], pagination: { offset: 0, pageSize: 10, totalCount: 1 } } }
```

To create something instead of listing it, run the same shape as a dry run first (see [Dry run](#dry-run)), check the resolved request against `ads_schema`, then call it for real.

---

## Ad account scoping

Most Apple Ads calls are scoped to one ad account. The server sends this as the `X-Ap-Context` header:

```
X-Ap-Context: adAccountId=123456789;
```

You do not build this header yourself. Either:

- set `APPLE_ADS_AD_ACCOUNT_ID` once in your environment, so every scoped call uses it by default, or
- pass `adAccountId` per call inside `args` (or as a top-level field next to `operation`), which overrides the default for that one call.

A handful of operations do **not** need an ad account and work with just your access token: `me_list` (`GET /me`) and `acls_list` (`GET /acls`). Call `acls_list` first — it returns every ad account your credentials can reach, plus your role on each, so you know which `adAccountId` values are valid before scoping any other call to one.

---

## Query, pagination and sorting

Most list-style endpoints follow the same shape: `POST /<resource>/query` with a selector body of `filters`, `sorting` and `pagination`. This is the same pattern whether you're querying campaigns, ad groups, keywords, creatives, or a report.

```jsonc
// POST /campaigns/query
{
  "filters": [
    { "field": "status", "operator": "EQUALS", "value": "ENABLED" }
  ],
  "sorting": [
    { "field": "name", "order": "ASC" }
  ],
  "pagination": {
    "offset": 0,
    "pageSize": 10,
    "fetchTotalCount": true
  }
}
```

**Filters** (`field`, `operator`, `value`, optional `ignoreCase`) support a wide operator set: `EQUALS`, `NOT_EQUALS`, `IN`, `NOT_IN`, `CONTAINS_ANY`, `CONTAINS_ALL`, `NOT_CONTAINS_ANY`, `NOT_CONTAINS_ALL`, `STARTS_WITH`, `ENDS_WITH`, `LIKE`, `NOT_LIKE`, `BETWEEN`, `GREATER_THAN`, `GREATER_THAN_OR_EQUAL_TO`, `LESS_THAN`, `LESS_THAN_OR_EQUAL_TO`, `IS_NULL`, `IS_NOT_NULL`. Not every field on every entity supports every operator — check the field list in `ads_schema` for the operation you're calling.

**Sorting** takes `field` and `order` (`ASC` or `DESC`). Omit it and results sort by `id` ascending.

**Pagination** takes `offset` and `pageSize`, with `fetchTotalCount` (default `false`) to also return the total match count. Reporting endpoints cap `pageSize` at 5000 and default to 100 when omitted; other `/query` endpoints don't document a fixed cap — start with a modest `pageSize` and page through with `offset`.

Keywords and negative keywords also have bulk endpoints (`keywords_bulkCreate`, `keywords_bulkUpdate`, `negativeKeywords_bulkCreate`, `negativeKeywords_bulkUpdate`) that take an `items` array, each with a client-supplied `correlationId` and a `data` payload, plus an `allowPartialSuccess` flag.

---

## Reports

The `Reports` tag covers 10 operations: app-level and business-brand-level performance reports by campaign, ad group, ad, keyword and search term (`reports_appsCampaignsQuery`, `reports_appsAdgroupsQuery`, `reports_appsAdsQuery`, `reports_appsKeywordsQuery`, `reports_appsSearchtermsQuery`, and the equivalent `reports_businessBrandsCampaignsQuery` / `reports_businessBrandsAdgroupsQuery` / `reports_businessBrandsAdsQuery` / `reports_businessBrandsKeywordsQuery` / `reports_businessBrandsSearchtermsQuery` for Apple Maps brand ads).

Every report operation is a `POST /reports/.../query` call taking the same `filters` / `sorting` / `pagination` selector body described above, scoped to an ad account:

```jsonc
{
  "operation": "reports_appsCampaignsQuery",
  "args": {
    "adAccountId": "123456789",
    "body": {
      "pagination": { "pageSize": 100 }
    }
  }
}
```

Run `ads_schema { operation: "reports_appsCampaignsQuery" }` first to see the exact filterable/groupable fields for that report before calling it — they differ per report type.

---

## Errors and rate limits

- Apple's response body is passed through intact. On a `4xx`/`5xx`, the agent sees Apple's own `error.code`, `error.message` and `error.details`, so it can read exactly what was rejected and self-correct.
- On `401`, this server refreshes the access token once and retries automatically — you shouldn't see stale-token errors surface to the agent.
- On `429`, the response includes a `hint` plus the rate-limit response headers Apple sent (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` when present). The server does not retry on your behalf — back off using those headers, preferring `Retry-After` when it's present. Apple's docs don't publish a fixed numeric limit, so don't hardcode one; read the headers on each response instead.
- A bulk request (`keywords_bulkCreate`, etc.) counts as a single call against the rate limit no matter how many items it carries — batch changes into bulk requests when operating at scale.
- Responses over ~120,000 characters are truncated with a hint to narrow the request. For list/report endpoints, lower `pageSize` or add more specific `filters` instead of pulling everything at once.

---

## Dry run

Every `ads_call` accepts `_dryRun: true`. It resolves the request — method, path, path params, query, headers, body, and the ad account context — without sending anything to Apple:

```jsonc
{
  "operation": "campaigns_update",
  "_dryRun": true,
  "args": {
    "id": "542370549",
    "adAccountId": "123456789",
    "body": { "status": "PAUSED" }
  }
}
```

```jsonc
{
  "dryRun": true,
  "operationId": "campaignsIdPut",
  "method": "PUT",
  "path": "/campaigns/{id}",
  "pathParams": { "id": "542370549" },
  "query": {},
  "headers": {},
  "body": { "status": "PAUSED" },
  "adAccountId": "123456789",
  "xApContext": "adAccountId=123456789;"
}
```

Use this to check a write request against `ads_schema` before it touches a live ad account.

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `APPLE_ADS_CLIENT_ID` | yes | Client ID from the Apple Ads UI credentials block |
| `APPLE_ADS_TEAM_ID` | yes | Team ID from the same credentials block |
| `APPLE_ADS_KEY_ID` | yes | Key ID from the same credentials block |
| `APPLE_ADS_PRIVATE_KEY_PATH` | yes* | Absolute path to your EC private key file |
| `APPLE_ADS_PRIVATE_KEY` | yes* | Inline PEM contents, instead of a file path (useful in CI) |
| `APPLE_ADS_AD_ACCOUNT_ID` | no | Default ad account ID for `X-Ap-Context`. Discover valid values with `acls_list` |
| `APPLE_ADS_BASE_URL` | no | Defaults to `https://api.ads.apple.com/v1` |
| `APPLE_ADS_AUTH_BASE_URL` | no | Defaults to `https://appleid.apple.com` |
| `APPLE_ADS_EXPOSE_ALL_TOOLS` | no | `1` or `true` registers all 99 operations as individual MCP tools. Debug only |

\* Supply exactly one of `APPLE_ADS_PRIVATE_KEY_PATH` or `APPLE_ADS_PRIVATE_KEY`.

Copy `.env.example` to `.env` for local shells. `.env*`, `*.p8` and `*.pem` are already in `.gitignore`.

---

## How the catalog is generated

```text
openapi/apple-ads.openapi.json   →   bun run generate   →   generated/tools.json
                                                              generated/manifest.json
```

`openapi/apple-ads.openapi.json` is the vendored source of truth: reconstructed from Apple's official Node client (`apple/apple-ads-platform-api-node`, spec tag 109) and cross-checked endpoint by endpoint against Apple's published documentation. `scripts/generate-tools.ts` reads it and emits one catalog entry per path+method — 99 operations, 80 paths, 28 tags — into `generated/tools.json`, plus counts and provenance into `generated/manifest.json`.

Tool descriptions are enriched from Apple's own documentation. `generated/docs.json` maps every `METHOD /path` to the title, abstract and URL of its page on developer.apple.com, so `ads_search` and `ads_schema` return Apple's own wording and a link you can open.

```bash
bun run generate   # rebuild the catalog from openapi/apple-ads.openapi.json
bun run docs       # refresh generated/docs.json from developer.apple.com
bun run smoke      # regenerate, validate the catalog, boot the server
```

Coverage is verified, not assumed. Apple publishes 99 endpoint pages; this catalog has 99 operations, and every one matches 1:1 by method and path shape. The full endpoint-by-endpoint comparison is in [docs/endpoint-coverage.md](docs/endpoint-coverage.md).

`generated/` is build output. Never hand-edit it — change the spec or the generator, then regenerate. CI fails if the committed catalog doesn't match a fresh generation.

---

## Escape hatch: every operation as its own tool

```bash
export APPLE_ADS_EXPOSE_ALL_TOOLS=1   # also register all 99 operations as individual MCP tools
```

Leave this **unset** in normal use — it exists for debugging the generated catalog, not for everyday agent use, and it puts every operation's full schema back into context.

---

## Security

- **Nothing secret is stored in this repository.** Credentials come from environment variables only.
- `.gitignore` blocks `*.p8`, `*.pem`, `PrivateKey_*.p8` and `.env*`.
- The client secret is a short-lived-by-policy ES256 JWT you sign locally with your private key (valid up to 180 days, Apple's own maximum); Apple never receives the private key itself. The resulting access token lives 3600 seconds, is cached in memory only, and is refreshed with a 60-second margin before it expires — plus a one-time retry on a `401`.
- Tool results never echo credentials back to the model.
- The only network destinations are `APPLE_ADS_BASE_URL` (defaults to Apple's API host) and `APPLE_ADS_AUTH_BASE_URL` (defaults to Apple's OAuth host).
- If you ever commit a private key by accident, rotate it in the Apple Ads UI immediately.

See [SECURITY.md](SECURITY.md) for reporting a vulnerability.

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Two rules matter most: `generated/` is regenerated rather than edited by hand, and no credentials ever appear in a pull request.

---

## License

[MIT](LICENSE) © imfaisii

Not affiliated with or endorsed by Apple Inc.

</content>
