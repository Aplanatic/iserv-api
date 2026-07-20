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
});
