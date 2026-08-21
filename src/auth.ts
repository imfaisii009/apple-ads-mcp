import { createHash, createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { SignJWT, importPKCS8 } from "jose";

export type AdsCredentials = {
  clientId: string;
  teamId: string;
  keyId: string;
  /** PEM contents of the .p8 private key */
  privateKeyPem: string;
  /** OAuth token host, no trailing slash */
  authBaseUrl: string;
};

/** Apple allows a client-secret JWT to live up to 180 days. */
const CLIENT_SECRET_TTL_SECONDS = 86_400 * 180;
const AUTH_AUDIENCE = "https://appleid.apple.com";
const TOKEN_ENDPOINT_PATH = "/auth/oauth2/token";
const OAUTH_SCOPE = "searchadsorg";
const GRANT_TYPE = "client_credentials";
/** Refresh this long before the access token actually expires. */
const REFRESH_SKEW_MS = 60_000;

let cached:
  | {
      token: string;
      expiresAt: number;
      fingerprint: string;
    }
  | undefined;

function fingerprint(creds: AdsCredentials): string {
  // Hash the key so a rotated key of the same length invalidates the cache.
  const keyHash = createHash("sha256")
    .update(creds.privateKeyPem)
    .digest("hex")
    .slice(0, 16);
  return `${creds.clientId}:${creds.teamId}:${creds.keyId}:${keyHash}`;
}

/** Load credentials from env. Never logs secret material. */
export function loadCredentialsFromEnv(): AdsCredentials {
  const clientId = process.env.APPLE_ADS_CLIENT_ID || "";
  const teamId = process.env.APPLE_ADS_TEAM_ID || "";
  const keyId = process.env.APPLE_ADS_KEY_ID || "";
  const keyPath = process.env.APPLE_ADS_PRIVATE_KEY_PATH || "";
  const keyInline = process.env.APPLE_ADS_PRIVATE_KEY || "";
  const authBaseUrl = (
    process.env.APPLE_ADS_AUTH_BASE_URL || AUTH_AUDIENCE
  ).replace(/\/+$/, "");

  const missing = [
    !clientId && "APPLE_ADS_CLIENT_ID",
    !teamId && "APPLE_ADS_TEAM_ID",
    !keyId && "APPLE_ADS_KEY_ID",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Missing Apple Ads credentials: ${missing.join(", ")}. Create an API key in the Apple Ads UI under Settings → API, then set APPLE_ADS_CLIENT_ID, APPLE_ADS_TEAM_ID, APPLE_ADS_KEY_ID and APPLE_ADS_PRIVATE_KEY_PATH.`,
    );
  }

  let privateKeyPem = keyInline;
  if (!privateKeyPem && keyPath) {
    try {
      privateKeyPem = readFileSync(keyPath, "utf8");
    } catch {
      throw new Error(
        `Could not read the Apple Ads private key at APPLE_ADS_PRIVATE_KEY_PATH=${keyPath}.`,
      );
    }
  }
  if (!privateKeyPem) {
    throw new Error(
      "Missing Apple Ads private key. Set APPLE_ADS_PRIVATE_KEY_PATH to a .p8 file or APPLE_ADS_PRIVATE_KEY to PEM contents.",
    );
  }

  // Support escaped newlines from env files
  privateKeyPem = privateKeyPem.replace(/\\n/g, "\n").trim();
  if (!privateKeyPem.includes("BEGIN")) {
    // bare base64 body → wrap
    privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${privateKeyPem}\n-----END PRIVATE KEY-----`;
  }

  return { clientId, teamId, keyId, privateKeyPem, authBaseUrl };
}

/**
 * Sign the ES256 client-secret JWT Apple expects in the token exchange.
 * Claims and lifetime match Apple's own client libraries.
 */
export async function createClientSecret(
  creds: AdsCredentials,
  nowMs = Date.now(),
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + CLIENT_SECRET_TTL_SECONDS;

  try {
    const key = await importPKCS8(creds.privateKeyPem, "ES256");
    return await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: creds.keyId, typ: "JWT" })
      .setSubject(creds.clientId)
      .setIssuer(creds.teamId)
      .setAudience(AUTH_AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(key);
  } catch {
    // Fallback via node crypto if jose rejects the key form
    return signWithNodeCrypto(creds, iat, exp);
  }
}

/**
 * Exchange the client secret for an OAuth access token, caching until it is
 * close to expiry. Set `force` to bypass the cache after a 401.
 */
export async function getAccessToken(
  creds: AdsCredentials,
  opts: { force?: boolean; nowMs?: number } = {},
): Promise<{ token: string; expiresAt: number }> {
  const nowMs = opts.nowMs ?? Date.now();
  const fp = fingerprint(creds);
  if (
    !opts.force &&
    cached &&
    cached.fingerprint === fp &&
    cached.expiresAt - REFRESH_SKEW_MS > nowMs
  ) {
    return { token: cached.token, expiresAt: cached.expiresAt };
  }

  const clientSecret = await createClientSecret(creds, nowMs);
  const body = new URLSearchParams({
    grant_type: GRANT_TYPE,
    client_id: creds.clientId,
    client_secret: clientSecret,
    scope: OAUTH_SCOPE,
  });

  const url = `${creds.authBaseUrl}${TOKEN_ENDPOINT_PATH}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error while fetching Apple Ads access token: ${message}`);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Apple Ads token request failed with HTTP ${res.status}: ${text.slice(0, 500) || "(empty body)"}`,
    );
  }

  let payload: { access_token?: string; expires_in?: number };
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Apple Ads token endpoint returned a non-JSON response.");
  }
  if (!payload.access_token) {
    throw new Error("Apple Ads token response is missing access_token.");
  }
  const expiresIn = Number(payload.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error(
      `Apple Ads token response has an invalid expires_in (got ${payload.expires_in}).`,
    );
  }

  const expiresAt = nowMs + expiresIn * 1000;
  cached = { token: payload.access_token, expiresAt, fingerprint: fp };
  return { token: payload.access_token, expiresAt };
}

function signWithNodeCrypto(
  creds: AdsCredentials,
  iat: number,
  exp: number,
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "ES256", kid: creds.keyId, typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: creds.clientId,
      iss: creds.teamId,
      aud: AUTH_AUDIENCE,
      iat,
      exp,
    }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const key = createPrivateKey(creds.privateKeyPem);
  const sig = createSign("SHA256").update(data).sign(key);
  // Convert DER ECDSA to JOSE raw r||s
  const raw = derToJose(sig, 32);
  return `${data}.${raw.toString("base64url")}`;
}

function derToJose(der: Buffer, size: number): Buffer {
  // SEQUENCE { INTEGER r, INTEGER s }
  let offset = 2;
  if (der[1]! & 0x80) offset += der[1]! & 0x7f;
  if (der[offset] !== 0x02) throw new Error("Invalid ECDSA DER");
  const rLen = der[offset + 1]!;
  let r = der.subarray(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;
  if (der[offset] !== 0x02) throw new Error("Invalid ECDSA DER");
  const sLen = der[offset + 1]!;
  let s = der.subarray(offset + 2, offset + 2 + sLen);
  if (r[0] === 0x00) r = r.subarray(1);
  if (s[0] === 0x00) s = s.subarray(1);
  const out = Buffer.alloc(size * 2);
  r.copy(out, size - r.length);
  s.copy(out, size * 2 - s.length);
  return out;
}

export function clearTokenCache(): void {
  cached = undefined;
}
