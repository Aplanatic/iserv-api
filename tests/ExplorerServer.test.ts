import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { IServAPI } from "../src/Core/IServClient.js";
import { startExplorerServer } from "../src/Explorer/ExplorerServer.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((item) => item())));

describe("startExplorerServer", () => {
  test("serves assets and requires a bearer token for local API calls", async () => {
    const directory = await mkdtemp(join(tmpdir(), "iserv-explorer-"));
    await writeFile(join(directory, "index.html"), "<h1>Explorer</h1>");
    cleanup.push(() => rm(directory, { recursive: true }));
    const executeReadRoute = vi.fn().mockResolvedValue({ routeId: "account.get", status: 200, data: {} });
    const server = await startExplorerServer({
      assetsDirectory: directory,
      client: { executeReadRoute } as unknown as IServAPI,
    });
    cleanup.push(server.close);
    const url = new URL(server.url);

    expect(await (await fetch(url.origin)).text()).toContain("Explorer");
    expect((await fetch(`${url.origin}/api/catalog`)).status).toBe(401);
    expect((await fetch(`${url.origin}/api/catalog`, { headers: { Authorization: `Bearer ${server.token}` } })).status).toBe(200);

    const response = await fetch(`${url.origin}/api/try`, {
      method: "POST",
      headers: { Authorization: `Bearer ${server.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ routeId: "account.get" }),
    });
    expect(response.status).toBe(200);
    expect(executeReadRoute).toHaveBeenCalledWith("account.get", {});
  });
});
