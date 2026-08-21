#!/usr/bin/env bun
/**
 * Optional live check against the Apple Ads Platform API.
 * Requires APPLE_ADS_CLIENT_ID, APPLE_ADS_TEAM_ID, APPLE_ADS_KEY_ID, and
 * APPLE_ADS_PRIVATE_KEY_PATH or APPLE_ADS_PRIVATE_KEY.
 *
 * Exits 0 (no-op) when credentials are absent so CI stays green.
 * Never prints token or key material.
 *
 *   APPLE_ADS_CLIENT_ID=… APPLE_ADS_TEAM_ID=… APPLE_ADS_KEY_ID=… \
 *     APPLE_ADS_PRIVATE_KEY_PATH=…/AuthKey_….p8 bun run scripts/live-check.ts
 */
import { adsRequest } from "../src/client.ts";

const hasCreds =
  process.env.APPLE_ADS_CLIENT_ID &&
  process.env.APPLE_ADS_TEAM_ID &&
  process.env.APPLE_ADS_KEY_ID &&
  (process.env.APPLE_ADS_PRIVATE_KEY_PATH || process.env.APPLE_ADS_PRIVATE_KEY);

if (!hasCreds) {
  console.log(
    "live check skipped: set APPLE_ADS_CLIENT_ID, APPLE_ADS_TEAM_ID, APPLE_ADS_KEY_ID and APPLE_ADS_PRIVATE_KEY_PATH (or APPLE_ADS_PRIVATE_KEY) to run it.",
  );
  process.exit(0);
}

// GET /me needs no ad account context — harmless read-only call.
const res = await adsRequest({ method: "GET", path: "/me" });
console.log("status", res.status);
if (res.status >= 400) {
  console.log(JSON.stringify(res.body, null, 2).slice(0, 800));
  process.exit(1);
}
console.log(JSON.stringify(res.body, null, 2).slice(0, 800));
console.log("LIVE_OK");
