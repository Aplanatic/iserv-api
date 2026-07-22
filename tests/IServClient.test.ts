import { CookieJar } from "tough-cookie";
import { describe, expect, test, vi } from "vitest";
import { IServAPI } from "../src/Core/IServClient.js";

describe("IServAPI stored sessions", () => {
  test("preserves the keychain-scoped Matrix session across process restarts", () => {
    const restored = IServAPI.restore({
      hostname: "iserv.example",
      username: "alice",
      cookies: new CookieJar().serializeSync(),
      matrixToken: "matrix-test-token",
      matrixUserId: "@alice:iserv.example",
    });

    expect(restored.exportSession()).toMatchObject({
      matrixToken: "matrix-test-token",
      matrixUserId: "@alice:iserv.example",
    });
  });

  test("runs bounded read batches with one restored client", async () => {
    const restored = IServAPI.restore({
      hostname: "iserv.example",
      username: "alice",
      cookies: new CookieJar().serializeSync(),
    });
    const execute = vi.spyOn(restored, "executeReadRoute").mockImplementation(async (routeId) => ({
      routeId,
      status: 200,
      durationMs: 1,
      data: {},
    }));

    const results = await restored.executeReadRoutes([
      { routeId: "calendar.overview" },
      { routeId: "mail.overview" },
    ]);

    expect(results.map((result) => result.routeId)).toEqual(["calendar.overview", "mail.overview"]);
    expect(execute).toHaveBeenCalledTimes(2);
    await expect(
      restored.executeReadRoutes(Array.from({ length: 9 }, () => ({ routeId: "mail.overview" }))),
    ).rejects.toThrow(/between 1 and 8/);
  });

  test("triggers onSessionRefreshed callback when refreshSession is executed", async () => {
    const restored = IServAPI.restore({
      hostname: "iserv.example",
      username: "alice",
      password: "secretpassword",
      cookies: new CookieJar().serializeSync(),
    });
    const listener = vi.fn();
    restored.onSessionRefreshed = listener;

    vi.spyOn(restored["auth"], "refreshSession").mockResolvedValue(true);

    const refreshed = await restored.refreshSession();
    expect(refreshed).toBe(true);
    expect(listener).toHaveBeenCalledWith(restored);
  });

  test("validateSession falls back to refreshSession if getOwnInfo rejects", async () => {
    const restored = IServAPI.restore({
      hostname: "iserv.example",
      username: "alice",
      password: "secretpassword",
      cookies: new CookieJar().serializeSync(),
    });
    vi.spyOn(restored.users, "getOwnInfo").mockRejectedValue(new Error("HTTP 401"));
    const refreshSpy = vi.spyOn(restored, "refreshSession").mockResolvedValue(true);

    const valid = await restored.validateSession();
    expect(valid).toBe(true);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });
});
