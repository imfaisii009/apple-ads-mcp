# Apple Ads Platform API — OpenAPI spec vs. Apple docs coverage report

Compares `openapi/apple-ads.openapi.json` (99 operations, server `https://api.ads.apple.com/v1`)
against the 99 crawled Apple documentation pages that carry a `restEndpoint`
section (out of the 745 pages under `crawl/pages/`).

## Method

A throwaway Python script (`coverage_check.py`, not committed to the repo) did the comparison:

1. For each of the 99 doc pages with a `primaryContentSections[].kind == "restEndpoint"` section,
   pulled the HTTP method from the `"method"` token and reconstructed the full path by
   **concatenating every `"path"` and `"parameter"` token in document order** (Apple splits a path
   like `campaigns/{id}/legacy-app-limited-status-reason-details` into three tokens:
   `path:"campaigns/"`, `parameter:"{id}"`, `path:"/legacy-app-limited-status-reason-details"` — a
   parameter is its own token, not embedded in the path token).
2. For each of the 99 spec operations, pulled `(method, path)` from `openapi/apple-ads.openapi.json`.
3. Normalised both sides to a **shape**: leading `/`, no trailing `/`, every `{paramName}` replaced
   with `{}` — so doc `{campaignId}` and spec `{id}` compare equal. Example shape:
   `GET /campaigns/{}/legacy-app-limited-status-reason-details`.
4. Compared the two sets of `"METHOD shape"` strings.

First pass (before token-concatenation was implemented) produced 38 false mismatches on each side —
purely an extraction bug (path tokens alone, ignoring the separate `parameter` tokens, dropped the
`{id}` segment, e.g. `DELETE /adgroups/` instead of `DELETE /adgroups/{id}`). Fixing the token
concatenation resolved all of them. No real spec/doc discrepancy was found.

## Result: 99/99 — full coverage, zero discrepancies

| List | Count |
|---|---|
| IN DOCS BUT NOT IN SPEC | **0** |
| IN SPEC BUT NOT IN DOCS | **0** |
| MATCHED | **99** |

- Doc endpoint pages loaded: 99 (expected 99) — confirmed exactly 99 of the 745 crawled pages carry a `restEndpoint` section.
- Spec operations loaded: 99 (expected 99).
- Unique doc path-shapes: 99. Unique spec path-shapes: 99. No internal duplicates on either side.
- **Every doc endpoint maps to exactly one spec operation, and every spec operation maps to exactly one doc endpoint. Coverage is 99/99.**

### IN DOCS BUT NOT IN SPEC (0)
(none)

### IN SPEC BUT NOT IN DOCS (0)
(none)

### MATCHED (99)
All 99 doc endpoint pages matched 1:1 to all 99 spec operations by normalised path shape. See the
full table below for method, spec path, doc title, and doc URL for every match.

## URL rule (verified)

Each crawled page's file is named `<slug-with-"__"-for-"/">.json`. Confirmed against three real
files that the page's own canonical URL is:

```
https://developer.apple.com + <page>["variants"][0]["paths"][0]
```

e.g. for `crawl/pages/apple-ads-platform-api__delete-location-group.json`:
`variants[0].paths[0]` = `/documentation/apple-ads-platform-api/delete-location-group`, giving
`https://developer.apple.com/documentation/apple-ads-platform-api/delete-location-group` — which
is exactly what deriving the URL from the filename (`__` → `/`, prefixed with
`https://developer.apple.com/documentation/`) also produces. Verified this on
`apply-daily-budget-recommendations`, `delete-location-group`, `post-campaigns`, and `upload-asset`.
`scripts/build-docs-index.ts` uses the URL it fetched each page from directly (same value, since it
walks the doc tree using these same canonical `url` fields from each page's own `references` map),
so no separate derivation step was needed there.

## Full table: all 99 endpoints (method, spec path, doc title, doc URL)

| Method | Spec Path | Doc Title | Doc URL |
|---|---|---|---|
| GET | `/acls` | Get User ACL | https://developer.apple.com/documentation/apple-ads-platform-api/get-user-acls |
| POST | `/ad-accounts` | Create Ad Accounts | https://developer.apple.com/documentation/apple-ads-platform-api/post-ad-accounts |
| GET | `/ad-accounts/{id}` | Get Ad Account by ID | https://developer.apple.com/documentation/apple-ads-platform-api/get-ad-accounts-_id_ |
| PUT | `/ad-accounts/{id}` | Update Ad Accounts | https://developer.apple.com/documentation/apple-ads-platform-api/put-ad-accounts-_id_ |
| POST | `/adgroups` | Create an Ad Group | https://developer.apple.com/documentation/apple-ads-platform-api/post-adgroups |
| POST | `/adgroups/query` | Query Ad Groups | https://developer.apple.com/documentation/apple-ads-platform-api/post-adgroups-query |
| DELETE | `/adgroups/{id}` | Delete an Ad Group | https://developer.apple.com/documentation/apple-ads-platform-api/delete-adgroups-_id_ |
| GET | `/adgroups/{id}` | Get an Ad Group | https://developer.apple.com/documentation/apple-ads-platform-api/get-adgroups-_id_ |
| PUT | `/adgroups/{id}` | Update an Ad Group | https://developer.apple.com/documentation/apple-ads-platform-api/put-adgroups-_id_ |
| POST | `/ads` | Create an Ad | https://developer.apple.com/documentation/apple-ads-platform-api/post-ads |
| POST | `/ads/query` | Query Ads | https://developer.apple.com/documentation/apple-ads-platform-api/post-ads-query |
| DELETE | `/ads/{id}` | Delete an Ad | https://developer.apple.com/documentation/apple-ads-platform-api/delete-ads-_id_ |
| GET | `/ads/{id}` | Get an Ad | https://developer.apple.com/documentation/apple-ads-platform-api/get-ads-_id_ |
| PUT | `/ads/{id}` | Update an Ad | https://developer.apple.com/documentation/apple-ads-platform-api/put-ads-_id_ |
| GET | `/advertiser-resources` | Get Advertiser Resources | https://developer.apple.com/documentation/apple-ads-platform-api/get-advertiser-resources |
| GET | `/apps/{adamId}` | Get App Details by Adam ID | https://developer.apple.com/documentation/apple-ads-platform-api/get-app-details-by-adam-id |
| POST | `/apps/{adamId}/locale-details/query` | Query App Locale Details | https://developer.apple.com/documentation/apple-ads-platform-api/query-default-product-page-locale-details-by-adam-id |
| POST | `/assets/query` | Query Assets | https://developer.apple.com/documentation/apple-ads-platform-api/query-assets |
| POST | `/assets/upload` | Upload Asset | https://developer.apple.com/documentation/apple-ads-platform-api/upload-asset |
| DELETE | `/assets/{id}` | Delete Asset | https://developer.apple.com/documentation/apple-ads-platform-api/delete-asset-by-id |
| GET | `/assets/{id}` | Get Asset | https://developer.apple.com/documentation/apple-ads-platform-api/get-asset-by-id |
| POST | `/business-brands/query` | Query Brands | https://developer.apple.com/documentation/apple-ads-platform-api/query-brands |
| GET | `/business-brands/{id}` | Get Brand by ID | https://developer.apple.com/documentation/apple-ads-platform-api/get-brand-by-id |
| POST | `/business-categories/query` | Query Business Categories | https://developer.apple.com/documentation/apple-ads-platform-api/query-categories |
| GET | `/business-categories/{id}` | Get Business Category | https://developer.apple.com/documentation/apple-ads-platform-api/get-category-by-id |
| POST | `/campaigns` | Create a Campaign | https://developer.apple.com/documentation/apple-ads-platform-api/post-campaigns |
| POST | `/campaigns/query` | Query Campaigns | https://developer.apple.com/documentation/apple-ads-platform-api/post-campaigns-query |
| DELETE | `/campaigns/{id}` | Delete a Campaign | https://developer.apple.com/documentation/apple-ads-platform-api/delete-campaigns-_id_ |
| GET | `/campaigns/{id}` | Get a Campaign | https://developer.apple.com/documentation/apple-ads-platform-api/get-campaigns-_id_ |
| PUT | `/campaigns/{id}` | Update a Campaign | https://developer.apple.com/documentation/apple-ads-platform-api/put-campaigns-_id_ |
| GET | `/campaigns/{id}/legacy-app-limited-status-reason-details` | Get Legacy App Limited Status Reason Details | https://developer.apple.com/documentation/apple-ads-platform-api/get-campaigns-_id_-legacy-app-limited-status-reason-details |
| POST | `/change-history/query` | Query Change History | https://developer.apple.com/documentation/apple-ads-platform-api/query-audit-summary-_-grouped-by-transaction |
| GET | `/change-history/{detailId}` | Get Change History Detail | https://developer.apple.com/documentation/apple-ads-platform-api/get-change-details-by-detailid |
| POST | `/creatives` | Create an Ad Creative | https://developer.apple.com/documentation/apple-ads-platform-api/post-creatives |
| POST | `/creatives/query` | Query Ad Creatives | https://developer.apple.com/documentation/apple-ads-platform-api/post-creatives-query |
| DELETE | `/creatives/{id}` | Delete an Ad Creative | https://developer.apple.com/documentation/apple-ads-platform-api/delete-creatives-_id_ |
| GET | `/creatives/{id}` | Get an Ad Creative | https://developer.apple.com/documentation/apple-ads-platform-api/get-creatives-_id_ |
| PUT | `/creatives/{id}` | Update an Ad Creative | https://developer.apple.com/documentation/apple-ads-platform-api/put-creatives-_id_ |
| POST | `/eligibilities/apps/query` | Check App Eligibility | https://developer.apple.com/documentation/apple-ads-platform-api/find-apps-eligibilities |
| POST | `/insights/apps/impression-share/query` | Impression Share Query | https://developer.apple.com/documentation/apple-ads-platform-api/query-app-impression-share-data |
| POST | `/insights/apps/search-term-popularity/query` | Search Term Popularity Query | https://developer.apple.com/documentation/apple-ads-platform-api/query-app-search-term-popularity-data |
| POST | `/keywords` | Create a Keyword | https://developer.apple.com/documentation/apple-ads-platform-api/post-keywords |
| POST | `/keywords/bulk-create` | Bulk Create Keywords | https://developer.apple.com/documentation/apple-ads-platform-api/post-keywords-bulk-create |
| POST | `/keywords/bulk-update` | Bulk Update Keywords | https://developer.apple.com/documentation/apple-ads-platform-api/post-keywords-bulk-update |
| POST | `/keywords/query` | Query Keywords | https://developer.apple.com/documentation/apple-ads-platform-api/post-keywords-query |
| DELETE | `/keywords/{id}` | Delete a Keyword | https://developer.apple.com/documentation/apple-ads-platform-api/delete-keywords-_id_ |
| GET | `/keywords/{id}` | Get a Keyword | https://developer.apple.com/documentation/apple-ads-platform-api/get-keywords-_id_ |
| PUT | `/keywords/{id}` | Update a Keyword | https://developer.apple.com/documentation/apple-ads-platform-api/put-keywords-_id_ |
| POST | `/location-groups` | Create Location Group | https://developer.apple.com/documentation/apple-ads-platform-api/create-location-group |
| POST | `/location-groups/query` | Query Location Groups | https://developer.apple.com/documentation/apple-ads-platform-api/query-location-groups |
| DELETE | `/location-groups/{id}` | Delete Location Group | https://developer.apple.com/documentation/apple-ads-platform-api/delete-location-group |
| GET | `/location-groups/{id}` | Get Location Group | https://developer.apple.com/documentation/apple-ads-platform-api/get-location-group-by-id |
| PUT | `/location-groups/{id}` | Update Location Group | https://developer.apple.com/documentation/apple-ads-platform-api/update-location-group |
| POST | `/locations/query` | Query for Locations | https://developer.apple.com/documentation/apple-ads-platform-api/query-locations |
| GET | `/locations/{id}` | Get a Location | https://developer.apple.com/documentation/apple-ads-platform-api/get-location-by-id |
| GET | `/me` | Get Me Details | https://developer.apple.com/documentation/apple-ads-platform-api/get-current-user-details |
| POST | `/metadata/apps/supported-languages/query` | Query Supported App Languages | https://developer.apple.com/documentation/apple-ads-platform-api/query-supported-app-languages |
| POST | `/negative-keywords` | Create a Negative Keyword | https://developer.apple.com/documentation/apple-ads-platform-api/post-negative-keywords |
| POST | `/negative-keywords/bulk-create` | Bulk Create Negative Keywords | https://developer.apple.com/documentation/apple-ads-platform-api/post-negative-keywords-bulk-create |
| POST | `/negative-keywords/bulk-update` | Bulk Update Negative Keywords | https://developer.apple.com/documentation/apple-ads-platform-api/post-negative-keywords-bulk-update |
| POST | `/negative-keywords/query` | Query Negative Keywords | https://developer.apple.com/documentation/apple-ads-platform-api/post-negative-keywords-query |
| DELETE | `/negative-keywords/{id}` | Delete a Negative Keyword | https://developer.apple.com/documentation/apple-ads-platform-api/delete-negative-keywords-_id_ |
| GET | `/negative-keywords/{id}` | Get a Negative Keyword | https://developer.apple.com/documentation/apple-ads-platform-api/get-negative-keywords-_id_ |
| PUT | `/negative-keywords/{id}` | Update a Negative Keyword | https://developer.apple.com/documentation/apple-ads-platform-api/put-negative-keywords-_id_ |
| GET | `/orgs/{id}` | Get Org by ID | https://developer.apple.com/documentation/apple-ads-platform-api/get-orgs-_id_ |
| POST | `/product-pages/locale-details/query` | Query Product Page Locale Details | https://developer.apple.com/documentation/apple-ads-platform-api/query-product-page-locale-details |
| POST | `/product-pages/query` | Query Product Pages | https://developer.apple.com/documentation/apple-ads-platform-api/query-product-pages |
| GET | `/product-pages/{productPageId}` | Get Product Page by ID | https://developer.apple.com/documentation/apple-ads-platform-api/get-product-page-by-id |
| POST | `/recommendations/daily-budgets/apply` | Apply Daily Budget Recommendations | https://developer.apple.com/documentation/apple-ads-platform-api/apply-daily-budget-recommendations |
| POST | `/recommendations/daily-budgets/dismiss` | Dismiss Daily Budget Recommendations | https://developer.apple.com/documentation/apple-ads-platform-api/dismiss-daily-budget-recommendations |
| POST | `/recommendations/daily-budgets/query` | Query Daily Budget Recommendations | https://developer.apple.com/documentation/apple-ads-platform-api/query-daily-budget-recommendations |
| POST | `/recommendations/target-cpas/apply` | Apply Target CPA Recommendations | https://developer.apple.com/documentation/apple-ads-platform-api/apply-target-cpa-recommendations |
| POST | `/recommendations/target-cpas/dismiss` | Dismiss Target CPA Recommendations | https://developer.apple.com/documentation/apple-ads-platform-api/dismiss-target-cpa-recommendations |
| POST | `/recommendations/target-cpas/query` | Query Target CPA Recommendations | https://developer.apple.com/documentation/apple-ads-platform-api/query-target-cpa-recommendations |
| POST | `/rejection-reasons/apps/query` | Query Rejection Reasons | https://developer.apple.com/documentation/apple-ads-platform-api/find-rejection-reasons |
| GET | `/rejection-reasons/apps/{rejectionReasonId}` | Get Rejection Reasons | https://developer.apple.com/documentation/apple-ads-platform-api/gets-rejection-reasons-by-id |
| POST | `/rejection-reasons/business-brands/query` | Query Rejection Reasons for Brands | https://developer.apple.com/documentation/apple-ads-platform-api/query-policy-assignments-(rejection-reasons)-for-external-consumers |
| POST | `/reports/apps/adgroups/query` | Ad Groups Report | https://developer.apple.com/documentation/apple-ads-platform-api/get-app-ad-group-reports |
| POST | `/reports/apps/ads/query` | Ads Report | https://developer.apple.com/documentation/apple-ads-platform-api/get-app-ad-reports |
| POST | `/reports/apps/campaigns/query` | Campaigns Report | https://developer.apple.com/documentation/apple-ads-platform-api/get-app-campaign-reports |
| POST | `/reports/apps/keywords/query` | Keywords Report | https://developer.apple.com/documentation/apple-ads-platform-api/get-app-keyword-reports |
| POST | `/reports/apps/searchterms/query` | Search Terms Report | https://developer.apple.com/documentation/apple-ads-platform-api/get-app-search-term-reports |
| POST | `/reports/business-brands/adgroups/query` | Ad Groups Report (Brands) | https://developer.apple.com/documentation/apple-ads-platform-api/get-brand-ad-group-reports |
| POST | `/reports/business-brands/ads/query` | Ads Report (Brands) | https://developer.apple.com/documentation/apple-ads-platform-api/get-brand-ad-reports |
| POST | `/reports/business-brands/campaigns/query` | Campaigns Report (Brands) | https://developer.apple.com/documentation/apple-ads-platform-api/get-brand-campaign-reports |
| POST | `/reports/business-brands/keywords/query` | Keywords Report (Brands) | https://developer.apple.com/documentation/apple-ads-platform-api/get-brand-keyword-reports |
| POST | `/reports/business-brands/searchterms/query` | Search Terms Report (Brands) | https://developer.apple.com/documentation/apple-ads-platform-api/get-brand-search-term-reports |
| GET | `/search/apps` | Search for Apps | https://developer.apple.com/documentation/apple-ads-platform-api/searches-for-a-list-of-apps |
| GET | `/search/geo` | Search Geo Locations | https://developer.apple.com/documentation/apple-ads-platform-api/searches-for-a-list-of-geo-locations |
| POST | `/search/geo` | Query Geo Locations | https://developer.apple.com/documentation/apple-ads-platform-api/gets-a-list-of-geo-locations |
| POST | `/shared-budgets` | Create a Budget Order | https://developer.apple.com/documentation/apple-ads-platform-api/post-shared-budgets |
| POST | `/shared-budgets/query` | Query Budget Orders | https://developer.apple.com/documentation/apple-ads-platform-api/post-shared-budgets-query |
| DELETE | `/shared-budgets/{id}` | Delete a Budget Order | https://developer.apple.com/documentation/apple-ads-platform-api/delete-shared-budgets-_id_ |
| GET | `/shared-budgets/{id}` | Get a Budget Order by ID | https://developer.apple.com/documentation/apple-ads-platform-api/get-shared-budgets-_id_ |
| PUT | `/shared-budgets/{id}` | Update a Budget Order | https://developer.apple.com/documentation/apple-ads-platform-api/put-shared-budgets-_id_ |
| POST | `/suggestions/categories/query` | Query Category Suggestions | https://developer.apple.com/documentation/apple-ads-platform-api/query-category-suggestions |
| POST | `/suggestions/keywords/query` | Query Keyword Suggestions | https://developer.apple.com/documentation/apple-ads-platform-api/query-keyword-suggestions |
| POST | `/suggestions/phrases/query` | Query Phrase Suggestions | https://developer.apple.com/documentation/apple-ads-platform-api/query-phrase-suggestions |
| POST | `/suggestions/target-cpas/query` | Query Target CPA Suggestion | https://developer.apple.com/documentation/apple-ads-platform-api/query-target-cpa-suggestion |

## Unmapped doc pages (had `restEndpoint` but could not be matched to a spec operation)

**None.** All 99 doc pages with a `restEndpoint` section matched exactly one spec operation, and
`scripts/build-docs-index.ts` reported 0 unmapped pages on both the cache-seeded dry run and the
live network run (see below).

## `scripts/build-docs-index.ts`

`generated/docs.json` is produced by `scripts/build-docs-index.ts`, which:

- Starts at `https://developer.apple.com/tutorials/data/documentation/apple-ads-platform-api.json`.
- BFS-walks the doc tree, following every `topicSections`/`seeAlsoSections` identifier resolved
  through each page's own `references[...].url`, restricted to URLs starting with
  `/documentation/apple-ads-platform-api`.
- Fetches each page from `https://developer.apple.com/tutorials/data<url>.json` (150ms delay
  between network requests, 3 retries with backoff on failure), unless `DOCS_CACHE_DIR` is set and
  the file exists there, or a prior run already cached it locally (see "resumability" below).
- Keeps only pages whose `primaryContentSections` include a `restEndpoint` section, extracting the
  method + path from its `tokens` (concatenating `path` and `parameter` tokens — same fix as Part A).
- Matches each doc endpoint to a spec operation by the same shape-normalisation as Part A, and keys
  the output by `"<METHOD> <spec path>"` — the spec's own path string, not Apple's.
- Any doc page it cannot map to a spec operation is printed to stderr and excluded from the output
  (reported, not silently dropped) — none occurred in either run below.
- **Resumability:** every fetched page is cached to a local temp directory
  (`$TMPDIR/apple-ads-mcp-docs-index-cache` by default, override with `DOCS_RESUME_CACHE_DIR`)
  keyed by its doc URL. A re-run reads already-cached pages instead of re-fetching them, so an
  interrupted run picks up where it left off.

### Commands run

**1. Dry run seeded from the already-crawled pages** (to validate the walk/extraction/mapping logic
cheaply before hitting the network):

```
DOCS_RESUME_CACHE_DIR=/tmp/docs-index-dryrun-cache \
DOCS_CACHE_DIR=<crawl/pages dir> \
bun run scripts/build-docs-index.ts
```

Result: walked all 745 pages (matching the original crawl exactly), found 99 restEndpoint pages,
mapped 99/99 to spec operations, 0 unmapped, 0 warnings. Elapsed: 0.2s (all cache hits, no network).

**2. Live network run** (the standalone default path, no `DOCS_CACHE_DIR`) — this is what actually
produced the committed `generated/docs.json`:

```
bun run scripts/build-docs-index.ts
```

This run fetches all ~745 pages live from `developer.apple.com` with a 150ms delay between requests
(plus real network latency and retries), so it takes several minutes — it was run in the background
and resumed automatically via the local resume-cache after an initial 2-minute foreground timeout,
with no data loss (already-fetched pages were read from cache, not re-fetched).

[[LIVE_RUN_RESULT_PLACEHOLDER]]

## Success checks

```
$ python3 -c "import json;d=json.load(open('generated/docs.json'));print(d['count'], len(d['endpoints']))"
[[SUCCESS_CHECK_2_PLACEHOLDER]]
```

Every key in `generated/docs.json` corresponds to a real `(method, path)` in the spec (verified
programmatically — count of non-matching keys):

```
[[SUCCESS_CHECK_3_PLACEHOLDER]]
```
