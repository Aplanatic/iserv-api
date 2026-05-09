import { describe, expect, test } from "vitest";
import { AuthService } from "../src/Auth/AuthService.js";
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

describe("AuthService matrix token extraction", () => {
  const USER_ID = "abc-123";
  const messengerHtml = `<script id="php-data">${JSON.stringify({ iserv_user_id: USER_ID })}</script>`;
  const matrixBase = "https://iserv.example/_matrix/client/v3";

  const loginRoutes = [
    {
      method: "get" as const,
      url: "https://iserv.example/iserv/auth/login",
      response: {
        data: "<html><form action='/iserv/auth/login'></form></html>",
        url: "https://iserv.example/iserv/auth/login",
      },
    },
    {
      method: "post" as const,
      url: "https://iserv.example/iserv/auth/login",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      response: { data: "<html>Welcome!</html>", url: "https://iserv.example/iserv/" },
    },
    {
      method: "get" as const,
      url: "https://iserv.example/iserv/",
      response: { data: "<html>dashboard</html>", url: "https://iserv.example/iserv/" },
    },
  ];

  test("stores matrix token on session after login", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        ...loginRoutes,
        {
          method: "get" as const,
          url: "https://iserv.example/iserv/messenger/",
          response: { data: messengerHtml },
        },
        {
          method: "post" as const,
          url: `${matrixBase}/login`,
          headers: { "Content-Type": "application/json" },
          response: {
            data: JSON.stringify({
              access_token: "syt_abc_xyz",
              user_id: `@${USER_ID}:iserv.example`,
            }),
          },
        },
      ],
    });

    await new AuthService(session).login();

    expect(session.matrixToken).toBe("syt_abc_xyz");
    expectAllRoutesCalled();
  });

  test("throws when messenger page has no iserv_user_id", async () => {
    const { session } = createMockIServSession({
      routes: [
        ...loginRoutes,
        {
          method: "get" as const,
          url: "https://iserv.example/iserv/messenger/",
          response: { data: "<html>no php-data here</html>" },
        },
      ],
    });

    await expect(new AuthService(session).login()).rejects.toThrow("Could not retrieve user ID");
  });
});
