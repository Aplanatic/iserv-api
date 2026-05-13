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
          response: { data: "<html>messenger app</html>" },
        },
        {
          method: "post" as const,
          url: "https://iserv.example/iserv/messenger/authenticate",
          headers: { Accept: "*/*", Origin: "https://iserv.example" },
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

  test("stores matrix user ID returned by messenger authentication", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        ...loginRoutes,
        {
          method: "get" as const,
          url: "https://iserv.example/iserv/messenger/",
          response: { data: "<html>messenger app without php-data</html>" },
        },
        {
          method: "post" as const,
          url: "https://iserv.example/iserv/messenger/authenticate",
          headers: { Accept: "*/*", Origin: "https://iserv.example" },
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

    expect(session.matrixUserId).toBe(`@${USER_ID}:iserv.example`);
    expectAllRoutesCalled();
  });
});
