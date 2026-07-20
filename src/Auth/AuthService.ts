import { IServAuthError } from "../Core/Errors.js";
import { parseJson } from "../Core/HttpClient.js";
import type { IServSession } from "../Core/IServSession.js";
import { createLogger } from "../Core/Logger.js";

const log = createLogger("Auth");

export interface AuthChallenge {
  kind: "otp";
  field: string;
  prompt: string;
}

export type AuthChallengeHandler = (challenge: AuthChallenge) => Promise<string>;

function isAuthenticationUrl(url: string): boolean {
  const parsed = new URL(url);
  return parsed.pathname === "/iserv/auth/login" || parsed.pathname === "/iserv/auth/auth";
}

function isLoginUrl(url: string): boolean {
  return new URL(url).pathname === "/iserv/auth/login";
}

function isAppAuthUrl(url: string): boolean {
  return new URL(url).pathname === "/iserv/auth/auth";
}

function resolveHtmlRedirect(html: string, baseUrl: string): string | null {
  const metaRefresh = html.match(
    /<meta\b[^>]*http-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)[^>]*>/i,
  )?.[0];
  const content = metaRefresh?.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/i);
  const refreshUrl = (content?.[1] ?? content?.[2] ?? content?.[3])
    ?.replaceAll("&amp;", "&")
    .match(/url=(.+)$/i)?.[1];
  if (refreshUrl) return new URL(refreshUrl.replaceAll("&amp;", "&"), baseUrl).href;

  const redirectLink = html.match(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const href = redirectLink?.[1] ?? redirectLink?.[2];
  if (!href || href.startsWith("#")) return null;

  return new URL(href.replaceAll("&amp;", "&"), baseUrl).href;
}

type TextHttpResponse = {
  data: string;
  status: number;
  headers: unknown;
  url: string;
};

const NAVIGATION_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

function parseLoginForm(html: string): URLSearchParams {
  const params = new URLSearchParams();
  const inputPattern = /<input\b[^>]*>/gi;
  const attrPattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  for (const [input] of html.matchAll(inputPattern)) {
    const attrs = new Map<string, string>();
    for (const [, rawName, doubleQuoted, singleQuoted, bare] of input.matchAll(attrPattern)) {
      if (!rawName) continue;
      attrs.set(rawName.toLowerCase(), doubleQuoted ?? singleQuoted ?? bare ?? "");
    }

    const name = attrs.get("name");
    if (!name) continue;

    const type = attrs.get("type")?.toLowerCase();
    if (type === "checkbox" || type === "radio") {
      if (!attrs.has("checked")) continue;
    }

    params.set(name, attrs.get("value") ?? "");
  }

  return params;
}

function parseOtpChallenge(
  html: string,
  baseUrl: string,
): { action: string; field: string; params: URLSearchParams } | null {
  const form = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/i)?.[0];
  if (!form) return null;
  const fieldMatch = [
    ...form.matchAll(/<input\b[^>]*\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi),
  ]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .find((name) => /(?:otp|totp|2fa|auth.?code|verification.?code)/i.test(name));
  if (!fieldMatch) return null;
  const actionMatch = form.match(/\baction\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return {
    action: new URL(actionMatch?.[1] ?? actionMatch?.[2] ?? actionMatch?.[3] ?? baseUrl, baseUrl)
      .href,
    field: fieldMatch,
    params: parseLoginForm(form),
  };
}

export class AuthService {
  constructor(
    private readonly session: IServSession,
    private readonly challengeHandler?: AuthChallengeHandler,
  ) {}

  private async fetchText(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<TextHttpResponse> {
    const cookieJar = (this.session as IServSession & { cookieJar?: IServSession["cookieJar"] })
      .cookieJar;
    if (!cookieJar) {
      const config = options.headers ? { headers: options.headers } : {};
      if (options.method === "POST") {
        return this.session.http.post(url, options.body, config);
      }
      const res = await this.session.http.get(url, config);
      return { ...res, data: res.data as string };
    }

    const cookieHeader = cookieJar.getCookieStringSync(url);
    const headers = {
      ...NAVIGATION_HEADERS,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...options.headers,
    };
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers,
      redirect: "manual",
    };
    if (options.body !== undefined) init.body = options.body;
    const res = await fetch(url, init);

    const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const setCookies = getSetCookie?.call(res.headers) ?? [];
    const singleSetCookie = res.headers.get("set-cookie");
    for (const cookie of setCookies.length > 0
      ? setCookies
      : singleSetCookie
        ? [singleSetCookie]
        : []) {
      cookieJar.setCookieSync(cookie, url);
    }

    const location = res.headers.get("location");
    if (location && res.status >= 300 && res.status < 400) {
      return this.fetchText(new URL(location, url).href);
    }

    return {
      data: await res.text(),
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      url: res.url,
    };
  }

  private async followHtmlRedirects(res: TextHttpResponse): Promise<TextHttpResponse> {
    let current = res;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const redirectUrl = resolveHtmlRedirect(current.data as string, current.url);
      if (!redirectUrl) return current;

      const next = await this.session.http.get(redirectUrl);
      current = { ...next, data: next.data as string };
    }

    return current;
  }

  private async establishAppSession(): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const homeRes = await this.session.http.get(`${this.session.baseUrl()}/iserv/`);

      if (!isAuthenticationUrl(homeRes.url)) return;
      if (isLoginUrl(homeRes.url)) break;
      if (isAppAuthUrl(homeRes.url)) continue;
    }

    throw new IServAuthError("Login failed! Session was not established.");
  }

  private async completeInteractiveChallenge(res: TextHttpResponse): Promise<TextHttpResponse> {
    const challenge = parseOtpChallenge(res.data, res.url);
    if (!challenge) return res;
    if (!this.challengeHandler) {
      throw new IServAuthError(
        "Two-factor authentication is required; provide a challenge handler.",
      );
    }
    const value = await this.challengeHandler({
      kind: "otp",
      field: challenge.field,
      prompt: "Enter the one-time authentication code",
    });
    challenge.params.set(challenge.field, value.trim());
    return this.fetchText(challenge.action, {
      method: "POST",
      body: challenge.params.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }

  async login(): Promise<void> {
    const loginUrl = `${this.session.baseUrl()}/iserv/`;

    try {
      const baseRes = await this.fetchText(loginUrl);
      const loginParams = parseLoginForm(baseRes.data as string);
      loginParams.set("_username", this.session.username);
      loginParams.set("_password", this.session.getPassword());

      const loginRes = await this.fetchText(baseRes.url, {
        method: "POST",
        body: loginParams.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const challengedRes = await this.completeInteractiveChallenge(loginRes);
      const postLoginRes = await this.followHtmlRedirects(challengedRes);

      const body = postLoginRes.data as string;
      if (body.includes("Account existiert nicht!"))
        throw new IServAuthError("Account does not exist!");
      if (body.includes("Anmeldung fehlgeschlagen!"))
        throw new IServAuthError("Login failed! Wrong password.");

      await this.establishAppSession();

      await this.authenticateMessenger();

      log.info("Login successful");
    } catch (err) {
      if (err instanceof IServAuthError) throw err;
      const message = err instanceof Error ? err.message : "Unknown connection error";
      throw new IServAuthError(`Connection error: ${message}`);
    }
  }

  async authenticateMessenger(): Promise<void> {
    await this.session.http.get(`${this.session.baseUrl()}/iserv/messenger/`);
    const messengerAuthRes = await this.session.http.post(
      `${this.session.baseUrl()}/iserv/messenger/authenticate`,
      null,
      { headers: { Accept: "*/*", Origin: this.session.baseUrl() } },
    );
    const matrixData = parseJson<Record<string, unknown>>(
      messengerAuthRes.data,
      "messenger authentication",
    );
    const matrixToken = (matrixData?.access_token as string) ?? null;
    const matrixUserId = (matrixData?.user_id as string) ?? undefined;
    if (!matrixToken) throw new IServAuthError("Could not retrieve a Matrix session token.");
    this.session.setMatrixToken(matrixToken, matrixUserId);
  }

  async logout(): Promise<void> {
    try {
      await this.session.http.get(`${this.session.baseUrl()}/iserv/auth/logout`);
    } finally {
      this.session.clearSession();
      log.info("Logged out");
    }
  }
}
