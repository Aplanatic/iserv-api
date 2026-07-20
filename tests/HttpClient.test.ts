import * as http from "node:http";
import { CookieJar } from "tough-cookie";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createHttpClient } from "../src/Core/HttpClient.js";

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: `${baseUrl}/final` });
      res.end();
    } else if (req.url === "/external-redirect") {
      res.writeHead(302, { Location: "https://outside.invalid/target" });
      res.end();
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
});
