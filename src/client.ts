import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  getAccessToken,
  loadCredentialsFromEnv,
  type AdsCredentials,
} from "./auth.js";

export const ADS_BASE_URL =
  process.env.APPLE_ADS_BASE_URL || "https://api.ads.apple.com/v1";

/** Header Apple uses to scope a request to one ad account (org). */
export const CONTEXT_HEADER = "X-Ap-Context";

export type AdsRequestOptions = {
  method: string;
  path: string;
  /** Path template params, e.g. { campaignId: "..." } */
  pathParams?: Record<string, string>;
  /** Query string values; arrays join with comma */
  query?: Record<string, unknown>;
  /** JSON body object, or raw string/Buffer */
  body?: unknown;
  /** Override Content-Type (asset upload uses multipart/form-data) */
  contentType?: string;
  /** Override Accept */
  accept?: string;
  /** Ad account (org) id for the X-Ap-Context header */
  adAccountId?: string;
  /** Extra headers */
  headers?: Record<string, string>;
  credentials?: AdsCredentials;
};

export type AdsResponse = {
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON when content-type is json; otherwise text or base64 note */
  body: unknown;
  contentType: string | null;
};

/** Build the `X-Ap-Context` value Apple expects: `adAccountId=1234567;` */
export function contextHeaderValue(adAccountId: string): string {
  const raw = String(adAccountId).trim();
  if (!raw) return "";
  // Already a well-formed context string: pass it through untouched.
  if (/^adAccountId=\d+;?$/.test(raw)) return raw.endsWith(";") ? raw : `${raw};`;
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `Invalid ad account ID: ${JSON.stringify(raw)}. Expected a numeric ID, or a context string like "adAccountId=1234567;". Use the acls operation to list the ad accounts your credentials can reach.`,
    );
  }
  return `adAccountId=${raw};`;
}

export function defaultAdAccountId(): string {
  // ORG_ID is the older Search Ads name for the same value.
  return (
    process.env.APPLE_ADS_AD_ACCOUNT_ID ||
    process.env.APPLE_ADS_ORG_ID ||
    ""
  );
}

export function fillPath(path: string, params?: Record<string, string>): string {
  if (!params) return path;
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined || v === null || v === "") {
      throw new Error(`Missing path parameter: ${name}`);
    }
    return encodeURIComponent(String(v));
  });
}

function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      sp.set(key, value.map(String).join(","));
    } else if (typeof value === "object") {
      sp.set(key, JSON.stringify(value));
    } else {
      sp.set(key, String(value));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function decodeBody(buf: Buffer, contentType: string | null): unknown {
  if (buf.length === 0) return null;

  if (contentType?.includes("application/json")) {
    const text = buf.toString("utf8");
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (
    contentType?.includes("text/") ||
    contentType?.includes("csv") ||
    contentType?.includes("xml")
  ) {
    return buf.toString("utf8");
  }
  if (
    contentType?.includes("gzip") ||
    contentType?.includes("zip") ||
    contentType?.includes("octet-stream") ||
    contentType?.includes("image/")
  ) {
    return {
      encoding: "base64",
      contentType,
      byteLength: buf.length,
      data: buf.toString("base64"),
      note: "Binary payload. Decode base64 to recover the file.",
    };
  }

  const asText = buf.toString("utf8");
  if (/^[\x09\x0a\x0d\x20-\x7e]*$/.test(asText)) return asText;
  return {
    encoding: "base64",
    contentType,
    byteLength: buf.length,
    data: buf.toString("base64"),
  };
}

/**
 * Turn a JSON body into multipart/form-data. An MCP client can only send JSON,
 * so a file part arrives as either { path } to read from disk or
 * { base64, filename?, contentType? }.
 */
function buildFormData(body: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      const part = value as Record<string, unknown>;
      const type =
        typeof part.contentType === "string" ? part.contentType : undefined;

      if (typeof part.path === "string") {
        const bytes = readFileSync(part.path);
        const name =
          typeof part.filename === "string" ? part.filename : basename(part.path);
        form.append(key, new Blob([bytes], type ? { type } : undefined), name);
        continue;
      }
      if (typeof part.base64 === "string") {
        const bytes = Buffer.from(part.base64, "base64");
        const name =
          typeof part.filename === "string" ? part.filename : key;
        form.append(key, new Blob([bytes], type ? { type } : undefined), name);
        continue;
      }
      form.append(key, JSON.stringify(value));
      continue;
    }

    form.append(key, String(value));
  }
  return form;
}

export async function adsRequest(
  opts: AdsRequestOptions,
): Promise<AdsResponse> {
  const creds = opts.credentials ?? loadCredentialsFromEnv();

  const path = fillPath(opts.path, opts.pathParams);
  const url = `${ADS_BASE_URL.replace(/\/$/, "")}${path}${buildQuery(opts.query)}`;

  let bodyInit: BodyInit | undefined;
  const bodyHeaders: Record<string, string> = {};
  if (opts.body !== undefined && opts.body !== null) {
    if (
      typeof opts.body === "string" ||
      opts.body instanceof Uint8Array ||
      opts.body instanceof ArrayBuffer
    ) {
      bodyInit = opts.body as BodyInit;
      if (opts.contentType) bodyHeaders["Content-Type"] = opts.contentType;
    } else if (opts.contentType?.startsWith("multipart/form-data")) {
      // Let fetch set Content-Type so it carries the multipart boundary.
      bodyInit = buildFormData(opts.body as Record<string, unknown>);
    } else {
      bodyHeaders["Content-Type"] = opts.contentType || "application/json";
      bodyInit = JSON.stringify(opts.body);
    }
  }

  const context = contextHeaderValue(
    opts.adAccountId || defaultAdAccountId(),
  );

  const send = async (token: string): Promise<Response> => {
    // Caller headers first so auth and content headers always win.
    const headers: Record<string, string> = {
      ...(opts.headers ?? {}),
      Authorization: `Bearer ${token}`,
      Accept: opts.accept || "application/json",
      ...bodyHeaders,
    };
    if (context) headers[CONTEXT_HEADER] = context;

    return fetch(url, {
      method: opts.method.toUpperCase(),
      headers,
      body: bodyInit,
    });
  };

  let { token } = await getAccessToken(creds);
  let res = await send(token);

  // A stale cached token shows up as a 401 — refresh once and retry.
  if (res.status === 401) {
    ({ token } = await getAccessToken(creds, { force: true }));
    res = await send(token);
  }

  const contentType = res.headers.get("content-type");
  const outHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    outHeaders[k] = v;
  });

  const buf = Buffer.from(await res.arrayBuffer());

  return {
    status: res.status,
    headers: outHeaders,
    body: decodeBody(buf, contentType),
    contentType,
  };
}

/** Format a response for MCP tool output (truncate huge payloads). */
export function formatToolResult(
  res: AdsResponse,
  maxChars = 120_000,
): { text: string; isError: boolean } {
  const isError = res.status >= 400;
  const payload: Record<string, unknown> = {
    status: res.status,
    contentType: res.contentType,
    body: res.body,
  };

  if (res.status === 429) {
    payload.hint =
      "Rate limited by Apple. Back off and retry; see the Retry-After / rate-limit response headers.";
    payload.rateLimitHeaders = Object.fromEntries(
      Object.entries(res.headers).filter(
        ([k]) => k.toLowerCase().includes("ratelimit") || k.toLowerCase() === "retry-after",
      ),
    );
  }

  let text = JSON.stringify(payload, null, 2);
  if (text.length > maxChars) {
    text =
      text.slice(0, maxChars) +
      `\n… truncated (${text.length} chars total). Narrow filters/fields or lower the page limit.`;
  }
  return { text, isError };
}
