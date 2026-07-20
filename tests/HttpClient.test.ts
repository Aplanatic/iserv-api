import * as http from "node:http";
import { CookieJar } from "tough-cookie";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createHttpClient } from "../src/Core/HttpClient.js";

let server: http.Server;
let baseUrl: string;
let hitCounts: Record<string, number>;

beforeAll(async () => {
  hitCounts = {};
  server = http.createServer((req, res) => {
    const path = req.url ?? "/";
    hitCounts[path] = (hitCounts[path] ?? 0) + 1;
    if (path === "/redirect") {
      res.writeHead(302, { Location: `${baseUrl}/final` });
      res.end();
    } else if (path === "/external-redirect") {
      res.writeHead(302, { Location: "https://outside.invalid/target" });
      res.end();
    } else if (path === "/rate-limit") {
      if (hitCounts[path] < 3) {
        res.writeHead(429, { "Retry-After": "0" });
        res.end("slow down");
        return;
      }
      res.writeHead(200);
      res.end("ok-after-retry");
    } else if (path === "/huge") {
      res.writeHead(200);
      res.end("x".repeat(2048));
    } else {
      res.writeHead(200);
      res.end("ok");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("createHttpClient", () => {
  test("get returns the final response URL after redirects", async () => {
    const client = createHttpClient(new CookieJar());

    const response = await client.get(`${baseUrl}/redirect`);

    expect(response.url).toBe(`${baseUrl}/final`);
    expect(response.data).toBe("ok");
  });

  test("blocks cross-origin redirects before contacting the target", async () => {
    const client = createHttpClient(new CookieJar());

    await expect(client.get(`${baseUrl}/external-redirect`)).rejects.toThrow(
      "Cross-origin redirect blocked",
    );
  });

  test("retries HTTP 429 with a clear final error when exhausted", async () => {
    hitCounts["/rate-limit"] = 0;
    const client = createHttpClient(new CookieJar(), { maxRetries: 1, timeoutMs: 5_000 });
    await expect(client.get(`${baseUrl}/rate-limit`)).rejects.toThrow(/Rate limited|HTTP 429/i);
  });

  test("succeeds after 429 retries", async () => {
    hitCounts["/rate-limit"] = 0;
    const client = createHttpClient(new CookieJar(), { maxRetries: 3, timeoutMs: 5_000 });
    const response = await client.get(`${baseUrl}/rate-limit`);
    expect(response.data).toBe("ok-after-retry");
  });

  test("rejects oversized Content-Length", async () => {
    const client = createHttpClient(new CookieJar(), { maxResponseBytes: 1024 });
    await expect(client.get(`${baseUrl}/huge`)).rejects.toThrow(/too large/i);
  });

  test("exposes a product User-Agent token", () => {
    const client = createHttpClient(new CookieJar());
    expect(client.userAgent).toMatch(/Aplanatic-IServ\//);
  });
});
