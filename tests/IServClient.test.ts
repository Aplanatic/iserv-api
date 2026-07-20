import { CookieJar } from "tough-cookie";
import { describe, expect, test } from "vitest";
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
});
