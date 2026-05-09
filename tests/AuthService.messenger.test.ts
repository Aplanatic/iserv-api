import { describe, expect, test } from "vitest";
import { createMockIServSession } from "./helpers/mockIServSession.js";
import { AuthService } from "../src/Auth/AuthService.js";

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
  test("stores matrix token on session after login", async () => {
    const messengerHtml = `<html><body>
      <script>
        var config = {"messenger_authentication":{"access_token":"syt_abc_xyz","device_id":"ISERV-CLIENT-u1","home_server":"test-server"}};
      </script>
    </body></html>`;

    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/auth/login",
          response: {
            data: "<html><form action='/iserv/auth/login'></form></html>",
            url: "https://iserv.example/iserv/auth/login",
          },
        },
        {
          method: "post",
          url: "https://iserv.example/iserv/auth/login",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          response: {
            data: "<html>Welcome!</html>",
            url: "https://iserv.example/iserv/",
          },
        },
        {
          method: "get",
          url: "https://iserv.example/iserv/",
          response: {
            data: "<html>dashboard</html>",
            url: "https://iserv.example/iserv/",
          },
        },
        {
          method: "get",
          url: "https://iserv.example/iserv/messenger/",
          response: { data: messengerHtml },
        },
      ],
    });

    await new AuthService(session).login();

    expect(session.matrixToken).toBe("syt_abc_xyz");
    expectAllRoutesCalled();
  });

  test("login succeeds even if messenger page has no token", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/auth/login",
          response: {
            data: "<html><form action='/iserv/auth/login'></form></html>",
            url: "https://iserv.example/iserv/auth/login",
          },
        },
        {
          method: "post",
          url: "https://iserv.example/iserv/auth/login",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          response: {
            data: "<html>Welcome!</html>",
            url: "https://iserv.example/iserv/",
          },
        },
        {
          method: "get",
          url: "https://iserv.example/iserv/",
          response: {
            data: "<html>dashboard</html>",
            url: "https://iserv.example/iserv/",
          },
        },
        {
          method: "get",
          url: "https://iserv.example/iserv/messenger/",
          response: { data: "<html>no token here</html>" },
        },
      ],
    });

    await new AuthService(session).login();

    expect(session.matrixToken).toBeNull();
    expectAllRoutesCalled();
  });
});
