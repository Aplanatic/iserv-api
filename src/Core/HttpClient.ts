import got, {
  type OptionsOfBufferResponseBody,
  type OptionsOfTextResponseBody,
  RequestError,
  TimeoutError,
} from "got";
import type { CookieJar } from "tough-cookie";
import { IServApiError } from "./Errors.js";

/** Browser-compatible base UA plus a product token so admins can spot toolkit traffic. */
export const BROWSER_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.179 Safari/537.36 Aplanatic-IServ/1.9.0",
};

export interface HttpClientOptions {
  /** Per-request timeout in ms (default: ISERV_TIMEOUT_MS or 30000). */
  timeoutMs?: number;
  /** Override User-Agent (default: BROWSER_HEADERS + optional ISERV_USER_AGENT). */
  userAgent?: string;
  /** Max retries for 429 / transient 5xx (default: 2). */
  maxRetries?: number;
  /** Reject responses larger than this many bytes (default: 15 MiB). */
  maxResponseBytes?: number;
  /** Optional callback to attempt session refresh on HTTP 401 or login redirect. */
  onAuthError?: () => Promise<boolean>;
}

export interface IServJsonResponse<T> {
  status: "success" | "error";
  data: T;
  message?: string;
  error?: string;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function parseJson<T>(value: unknown, context: string): T {
  if (typeof value !== "string") {
    if (value === null || value === undefined)
      throw new Error(`${context}: received null/undefined`);
    return value as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch (err) {
    throw new IServApiError(
      `Expected JSON response for ${context}: ${err instanceof Error ? err.message : "invalid JSON"}`,
      500,
    );
  }
}

export function parseIServJsonData<T>(value: unknown, context: string): T {
  const response = parseJson<IServJsonResponse<T>>(value, context);
  if (response.status !== "success") {
    throw new IServApiError(
      response.message ?? response.error ?? `IServ returned an error for ${context}`,
      500,
    );
  }
  return response.data;
}

type GetConfig = {
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  responseType?: "arraybuffer";
};

type PostConfig = {
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
};

function resolveTimeoutMs(options?: HttpClientOptions): number {
  if (typeof options?.timeoutMs === "number" && options.timeoutMs > 0) return options.timeoutMs;
  const fromEnv = Number(process.env.ISERV_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 30_000;
}

function resolveUserAgent(options?: HttpClientOptions): string {
  if (options?.userAgent?.trim()) return options.userAgent.trim();
  if (process.env.ISERV_USER_AGENT?.trim()) return process.env.ISERV_USER_AGENT.trim();
  return BROWSER_HEADERS["User-Agent"];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapRequestError(error: unknown, timeoutMs: number): never {
  if (error instanceof IServApiError) throw error;
  if (error instanceof TimeoutError) {
    throw new IServApiError(`Request timed out after ${timeoutMs}ms`, 408);
  }
  if (error instanceof RequestError) {
    const code = error.code ? ` (${error.code})` : "";
    throw new IServApiError(`Network request failed${code}: ${error.message}`, 503);
  }
  throw error;
}

function assertResponseSize(
  headers: Record<string, unknown>,
  bodyLength: number,
  maxResponseBytes: number,
): void {
  const raw = headers["content-length"];
  const declared =
    typeof raw === "string" ? Number(raw) : Array.isArray(raw) ? Number(raw[0]) : NaN;
  if (Number.isFinite(declared) && declared > maxResponseBytes) {
    throw new IServApiError(
      `Response too large (${declared} bytes; limit ${maxResponseBytes}). Use a smaller --limit or a more specific query.`,
      413,
    );
  }
  if (bodyLength > maxResponseBytes) {
    throw new IServApiError(
      `Response too large (${bodyLength} bytes; limit ${maxResponseBytes}). Use a smaller --limit or a more specific query.`,
      413,
    );
  }
}

function retryAfterMs(headers: Record<string, unknown>, attempt: number): number {
  const raw = headers["retry-after"];
  const value = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (value) {
    const asInt = Number(value);
    if (Number.isFinite(asInt) && asInt >= 0) return Math.min(asInt * 1000, 30_000);
  }
  return Math.min(500 * 2 ** attempt, 8_000);
}

export function createHttpClient(cookieJar: CookieJar, options: HttpClientOptions = {}) {
  let onAuthError = options.onAuthError;
  const timeoutMs = resolveTimeoutMs(options);
  const maxRetries = options.maxRetries ?? 2;
  const maxResponseBytes = options.maxResponseBytes ?? 15 * 1024 * 1024;
  const userAgent = resolveUserAgent(options);

  function setOnAuthError(handler?: () => Promise<boolean>): void {
    onAuthError = handler;
  }

  const client = got.extend({
    cookieJar,
    headers: { ...BROWSER_HEADERS, "User-Agent": userAgent },
    followRedirect: true,
    timeout: { request: timeoutMs },
    retry: { limit: 0 },
    hooks: {
      beforeRedirect: [
        (opts, response) => {
          if (!opts.url || opts.url.origin !== new URL(response.url).origin) {
            throw new IServApiError("Cross-origin redirect blocked", 400);
          }
        },
      ],
    },
    throwHttpErrors: false,
    https: { rejectUnauthorized: true },
  });

  async function withRetries<T>(
    run: () => Promise<{
      statusCode: number;
      body: T;
      headers: Record<string, unknown>;
      url: string;
    }>,
  ): Promise<{ data: T; status: number; headers: Record<string, unknown>; url: string }> {
    let attempt = 0;
    let authRefreshed = false;
    for (;;) {
      try {
        const res = await run();
        const isLoginRedirect =
          typeof res.body === "string" && new URL(res.url).pathname === "/iserv/auth/login";
        if ((res.statusCode === 401 || isLoginRedirect) && onAuthError && !authRefreshed) {
          authRefreshed = true;
          const refreshed = await onAuthError();
          if (refreshed) {
            continue;
          }
        }
        if (
          (res.statusCode === 429 || res.statusCode === 502 || res.statusCode === 503) &&
          attempt < maxRetries
        ) {
          await sleep(retryAfterMs(res.headers, attempt));
          attempt += 1;
          continue;
        }
        if (res.statusCode === 429) {
          throw new IServApiError(
            "Rate limited by IServ (HTTP 429). Wait and retry, or reduce request frequency.",
            429,
          );
        }
        if (res.statusCode >= 400) {
          throw new IServApiError(`HTTP ${res.statusCode}`, res.statusCode);
        }
        const bodyLength =
          typeof res.body === "string"
            ? Buffer.byteLength(res.body)
            : Buffer.isBuffer(res.body)
              ? res.body.length
              : 0;
        assertResponseSize(res.headers, bodyLength, maxResponseBytes);
        return {
          data: res.body,
          status: res.statusCode,
          headers: res.headers,
          url: res.url,
        };
      } catch (error) {
        mapRequestError(error, timeoutMs);
      }
    }
  }

  async function get(url: string, config: GetConfig = {}) {
    if (config.responseType === "arraybuffer") {
      return withRetries(async () => {
        const opts: OptionsOfBufferResponseBody = { responseType: "buffer" };
        if (config.params) opts.searchParams = config.params;
        if (config.headers) opts.headers = config.headers;
        const res = await client.get(url, opts);
        return {
          statusCode: res.statusCode,
          body: res.body as unknown as Buffer,
          headers: res.headers as Record<string, unknown>,
          url: res.url,
        };
      });
    }

    return withRetries(async () => {
      const opts: OptionsOfTextResponseBody = { responseType: "text" };
      if (config.params) opts.searchParams = config.params;
      if (config.headers) opts.headers = config.headers;
      const res = await client.get(url, opts);
      return {
        statusCode: res.statusCode,
        body: res.body as string,
        headers: res.headers as Record<string, unknown>,
        url: res.url,
      };
    });
  }

  async function post(url: string, body?: string | null, config: PostConfig = {}) {
    return withRetries(async () => {
      const opts: OptionsOfTextResponseBody = { responseType: "text" };
      if (body != null) opts.body = body;
      if (config.params) opts.searchParams = config.params;
      if (config.headers) opts.headers = config.headers;
      const res = await client.post(url, opts);
      return {
        statusCode: res.statusCode,
        body: res.body as string,
        headers: res.headers as Record<string, unknown>,
        url: res.url,
      };
    });
  }

  async function put(url: string, body?: string | null, config: PostConfig = {}) {
    return withRetries(async () => {
      const opts: OptionsOfTextResponseBody = { responseType: "text" };
      if (body != null) opts.body = body;
      if (config.params) opts.searchParams = config.params;
      if (config.headers) opts.headers = config.headers;
      const res = await client.put(url, opts);
      return {
        statusCode: res.statusCode,
        body: res.body as string,
        headers: res.headers as Record<string, unknown>,
        url: res.url,
      };
    });
  }

  async function patch(url: string, body?: string | null, config: PostConfig = {}) {
    return withRetries(async () => {
      const opts: OptionsOfTextResponseBody = { responseType: "text" };
      if (body != null) opts.body = body;
      if (config.params) opts.searchParams = config.params;
      if (config.headers) opts.headers = config.headers;
      const res = await client.patch(url, opts);
      return {
        statusCode: res.statusCode,
        body: res.body as string,
        headers: res.headers as Record<string, unknown>,
        url: res.url,
      };
    });
  }

  return { get, post, put, patch, timeoutMs, maxResponseBytes, userAgent, setOnAuthError };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
