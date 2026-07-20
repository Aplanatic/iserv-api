import { describe, expect, test } from "vitest";
import { AuthService } from "../src/Auth/AuthService.js";
import type { IServSession } from "../src/Core/IServSession.js";

type HttpCall = {
  method: "get" | "post";
  url: string;
  body?: string | null;
};

const MOCK_USER_ID = "abc-123";
const MESSENGER_AUTH_RESPONSE = JSON.stringify({
  access_token: "syt_test",
  user_id: `@${MOCK_USER_ID}:iserv.example`,
});

function createSession(
  responses: {
    get: Array<{ data: string; status: number; headers: Record<string, string>; url: string }>;
    post: Array<{ data: string; status: number; headers: Record<string, string>; url: string }>;
  },
  calls: HttpCall[] = [],
): IServSession {
  let matrixToken: string | null = null;
  return {
    username: "alice",
    baseUrl: () => "https://iserv.example",
    matrixBaseUrl: () => "https://iserv.example/_matrix/client/v3",
    getPassword: () => "secret",
    get matrixToken() {
      return matrixToken;
    },
    setMatrixToken: (token: string) => {
      matrixToken = token;
    },
    http: {
      get: async (url: string) => {
        calls.push({ method: "get", url });
        const response = responses.get.shift();
        if (!response) throw new Error(`Unexpected GET ${url}`);
        return response;
      },
      post: async (url: string, body?: string | null) => {
        calls.push({ method: "post", url, body });
        const response = responses.post.shift();
        if (!response) throw new Error(`Unexpected POST ${url}`);
        return response;
      },
    },
  } as unknown as IServSession;
}

describe("AuthService.login", () => {
  test("can renew only the Messenger session for a restored web session", async () => {
    const calls: HttpCall[] = [];
    const session = createSession(
      {
        get: [
          {
            data: "<main>messenger</main>",
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/messenger/",
          },
        ],
        post: [
          {
            data: MESSENGER_AUTH_RESPONSE,
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/messenger/authenticate",
          },
        ],
      },
      calls,
    );

    await new AuthService(session).authenticateMessenger();

    expect(session.matrixToken).toBe("syt_test");
    expect(calls.map((call) => call.method)).toEqual(["get", "post"]);
  });

  test("posts credentials to the resolved login URL and accepts a session that stays on /iserv/", async () => {
    const calls: HttpCall[] = [];
    const session = createSession(
      {
        get: [
          {
            data: `
              <form method="post">
                <input type="hidden" name="_csrf_token" value="csrf-123">
                <input type="hidden" name="_target_path" value="/iserv/">
                <input type="text" name="_username" value="">
                <input type="password" name="_password" value="">
              </form>
            `,
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/auth/login?_target_path=/iserv/",
          },
          { data: "<main></main>", status: 200, headers: {}, url: "https://iserv.example/iserv/" },
          {
            data: "<main>messenger app</main>",
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/messenger/",
          },
        ],
        post: [
          { data: "<main></main>", status: 200, headers: {}, url: "https://iserv.example/iserv/" },
          {
            data: MESSENGER_AUTH_RESPONSE,
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/messenger/authenticate",
          },
        ],
      },
      calls,
    );

    await new AuthService(session).login();

    expect(calls[1]).toEqual({
      method: "post",
      url: "https://iserv.example/iserv/auth/login?_target_path=/iserv/",
      body: "_csrf_token=csrf-123&_target_path=%2Fiserv%2F&_username=alice&_password=secret",
    });
  });

  test("rejects a login that redirects back into the login flow", async () => {
    const session = createSession({
      get: [
        {
          data: "<form></form>",
          status: 200,
          headers: {},
          url: "https://iserv.example/iserv/auth/login",
        },
        {
          data: "<form></form>",
          status: 200,
          headers: {},
          url: "https://iserv.example/iserv/auth/login?_target_path=/iserv/",
        },
      ],
      post: [
        {
          data: "<form></form>",
          status: 200,
          headers: {},
          url: "https://iserv.example/iserv/auth/login",
        },
      ],
    });

    await expect(new AuthService(session).login()).rejects.toThrow("Session was not established");
  });

  test("follows the app auth handoff before requiring /iserv/ to be established", async () => {
    const calls: HttpCall[] = [];
    const session = createSession(
      {
        get: [
          {
            data: "<form></form>",
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/auth/login",
          },
          {
            data: "<main></main>",
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/auth/auth?_iserv_app_url=%2Fiserv%2F&state=test",
          },
          { data: "<main></main>", status: 200, headers: {}, url: "https://iserv.example/iserv/" },
          {
            data: "<main>messenger app</main>",
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/messenger/",
          },
        ],
        post: [
          {
            data: "<main></main>",
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/auth/home",
          },
          {
            data: MESSENGER_AUTH_RESPONSE,
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/messenger/authenticate",
          },
        ],
      },
      calls,
    );

    await new AuthService(session).login();

    expect(
      calls.filter((call) => call.method === "get" && call.url === "https://iserv.example/iserv/"),
    ).toHaveLength(3);
  });

  test("follows the post-login meta refresh callback before checking the app session", async () => {
    const calls: HttpCall[] = [];
    const session = createSession(
      {
        get: [
          {
            data: "<form></form>",
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/auth/login?_target_path=/iserv/auth/auth",
          },
          {
            data: "<main>redirect callback</main>",
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/",
          },
          { data: "<main></main>", status: 200, headers: {}, url: "https://iserv.example/iserv/" },
          {
            data: "<main>messenger app</main>",
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/messenger/",
          },
        ],
        post: [
          {
            data: '<meta http-equiv="refresh" content="0;url=https://iserv.example/iserv/app/authentication/redirect?state=test&amp;code=test">',
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/auth/auth",
          },
          {
            data: MESSENGER_AUTH_RESPONSE,
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/messenger/authenticate",
          },
        ],
      },
      calls,
    );

    await new AuthService(session).login();

    expect(calls[2]).toEqual({
      method: "get",
      url: "https://iserv.example/iserv/app/authentication/redirect?state=test&code=test",
    });
  });

  test("blocks a cross-origin HTML handoff before contacting it", async () => {
    const calls: HttpCall[] = [];
    const session = createSession(
      {
        get: [
          {
            data: "<form></form>",
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/auth/login",
          },
        ],
        post: [
          {
            data: '<meta http-equiv="refresh" content="0;url=https://example.invalid/capture">',
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/auth/auth",
          },
        ],
      },
      calls,
    );

    await expect(new AuthService(session).login()).rejects.toThrow("Cross-origin");
    expect(calls).toHaveLength(2);
  });

  test("keeps the IServ error messages for invalid credentials", async () => {
    const session = createSession({
      get: [
        {
          data: "<form></form>",
          status: 200,
          headers: {},
          url: "https://iserv.example/iserv/auth/login",
        },
      ],
      post: [
        {
          data: "Anmeldung fehlgeschlagen!",
          status: 200,
          headers: {},
          url: "https://iserv.example/iserv/auth/login",
        },
      ],
    });

    await expect(new AuthService(session).login()).rejects.toThrow("Wrong password");
  });
});
