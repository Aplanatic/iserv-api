import { describe, expect, test } from "vitest";
import { AuthService } from "../src/Auth/AuthService.js";
import type { IServSession } from "../src/Core/IServSession.js";

type HttpCall = {
  method: "get" | "post";
  url: string;
  body?: string | null;
};

const MOCK_USER_ID = "abc-123";
const MESSENGER_HTML = `<script id="php-data">${JSON.stringify({ iserv_user_id: MOCK_USER_ID })}</script>`;
const MATRIX_LOGIN_RESPONSE = JSON.stringify({
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
  test("posts credentials to the resolved login URL and accepts a session that stays on /iserv/", async () => {
    const calls: HttpCall[] = [];
    const session = createSession(
      {
        get: [
          {
            data: "<form></form>",
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/auth/login?_target_path=/iserv/",
          },
          { data: "<main></main>", status: 200, headers: {}, url: "https://iserv.example/iserv/" },
          {
            data: MESSENGER_HTML,
            status: 200,
            headers: {},
            url: "https://iserv.example/iserv/messenger/",
          },
        ],
        post: [
          { data: "<main></main>", status: 200, headers: {}, url: "https://iserv.example/iserv/" },
          {
            data: MATRIX_LOGIN_RESPONSE,
            status: 200,
            headers: {},
            url: "https://iserv.example/_matrix/client/v3/login",
          },
        ],
      },
      calls,
    );

    await new AuthService(session).login();

    expect(calls[1]).toEqual({
      method: "post",
      url: "https://iserv.example/iserv/auth/login?_target_path=/iserv/",
      body: "_username=alice&_password=secret",
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
