import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, isAbsolute, join, normalize, relative as relativePath, resolve } from "node:path";
import type { IServAPI } from "../Core/IServClient.js";
import { routeCatalog } from "../Routes/RouteCatalog.js";

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > 65_536) throw new Error("Request body exceeds 64 KiB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

export async function startExplorerServer(options: {
  client?: IServAPI;
  assetsDirectory: string;
  port?: number;
}): Promise<{ url: string; token: string; close: () => Promise<void> }> {
  const token = randomBytes(32).toString("base64url");
  const assetsRoot = resolve(options.assetsDirectory);
  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host ?? "";
      if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) {
        return sendJson(response, 403, { error: "Invalid Host header" });
      }
      const requestUrl = new URL(request.url ?? "/", `http://${host}`);
      if (requestUrl.pathname.startsWith("/api/")) {
        if (request.headers.authorization !== `Bearer ${token}`) {
          return sendJson(response, 401, { error: "Invalid explorer token" });
        }
        const origin = request.headers.origin;
        if (origin && origin !== `http://${host}`) {
          return sendJson(response, 403, { error: "Invalid Origin header" });
        }
        if (requestUrl.pathname === "/api/catalog" && request.method === "GET") {
          return sendJson(response, 200, routeCatalog.routes);
        }
        if (requestUrl.pathname === "/api/try" && request.method === "POST") {
          if (!options.client)
            return sendJson(response, 409, { error: "No authenticated profile" });
          const body = (await readBody(request)) as { routeId?: unknown; parameters?: unknown };
          if (typeof body.routeId !== "string")
            return sendJson(response, 400, { error: "routeId is required" });
          const parameters =
            body.parameters && typeof body.parameters === "object"
              ? (body.parameters as Record<string, string | number | boolean>)
              : {};
          return sendJson(
            response,
            200,
            await options.client.executeReadRoute(body.routeId, parameters),
          );
        }
        return sendJson(response, 404, { error: "Unknown API endpoint" });
      }

      const relative =
        requestUrl.pathname === "/"
          ? "index.html"
          : normalize(requestUrl.pathname).replace(/^\/+/, "");
      const candidate = resolve(join(assetsRoot, relative));
      const relativeCandidate = relativePath(assetsRoot, candidate);
      if (relativeCandidate.startsWith("..") || isAbsolute(relativeCandidate)) {
        return sendJson(response, 404, { error: "Not found" });
      }
      const file = (await stat(candidate).catch(() => null))?.isFile()
        ? candidate
        : join(assetsRoot, "index.html");
      const contents = await readFile(file);
      response.writeHead(200, {
        "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
        "Content-Security-Policy":
          "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      });
      response.end(contents);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Explorer server failed to bind");
  return {
    url: `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(token)}`,
    token,
    close: () =>
      new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      ),
  };
}
