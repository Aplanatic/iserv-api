import { describe, expect, test } from "vitest";
import { createMockIServSession } from "./helpers/mockIServSession.js";

describe("IServSession matrix token", () => {
  test("matrixToken is null by default", () => {
    const { session } = createMockIServSession({ routes: [] });
    expect(session.matrixToken).toBeNull();
  });

  test("setMatrixToken stores the token", () => {
    const { session } = createMockIServSession({ routes: [] });
    session.setMatrixToken("syt_test_token");
    expect(session.matrixToken).toBe("syt_test_token");
  });

  test("matrixBaseUrl returns the Matrix API base", () => {
    const { session } = createMockIServSession({ routes: [] });
    expect(session.matrixBaseUrl()).toBe("https://iserv.example/_matrix/client/v3");
  });
});
