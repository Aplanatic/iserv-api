import { IServAuthError } from "../Core/Errors.js";
import { parseJson } from "../Core/HttpClient.js";
import type { IServSession } from "../Core/IServSession.js";
import { createLogger } from "../Core/Logger.js";

const log = createLogger("Auth");

function extractPhpData(html: string): Record<string, unknown> | null {
  const scriptMatch = html.match(/<script[^>]*id=["']php-data["'][^>]*>([\s\S]*?)<\/script>/);
  if (!scriptMatch) return null;
  try {
    return JSON.parse((scriptMatch[1] ?? "").trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isAuthenticationUrl(url: string): boolean {
  const parsed = new URL(url);
  return parsed.pathname === "/iserv/auth/login" || parsed.pathname === "/iserv/auth/auth";
}

export class AuthService {
  constructor(private readonly session: IServSession) {}

  async login(): Promise<void> {
    const loginUrl = `${this.session.baseUrl()}/iserv/auth/login`;

    try {
      const baseRes = await this.session.http.get(loginUrl);

      const loginRes = await this.session.http.post(
        baseRes.url,
        new URLSearchParams({
          _username: this.session.username,
          _password: this.session.getPassword(),
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );

      const body = loginRes.data as string;
      if (body.includes("Account existiert nicht!"))
        throw new IServAuthError("Account does not exist!");
      if (body.includes("Anmeldung fehlgeschlagen!"))
        throw new IServAuthError("Login failed! Wrong password.");

      const homeRes = await this.session.http.get(`${this.session.baseUrl()}/iserv/`);
      if (isAuthenticationUrl(homeRes.url)) {
        throw new IServAuthError("Login failed! Session was not established.");
      }

      const messengerRes = await this.session.http.get(
        `${this.session.baseUrl()}/iserv/messenger/`,
      );
      const phpData = extractPhpData(messengerRes.data as string);
      const iservUserId = phpData?.iserv_user_id as string | undefined;
      if (!iservUserId) throw new IServAuthError("Login failed! Could not retrieve user ID.");

      const matrixLoginRes = await this.session.http.post(
        `${this.session.matrixBaseUrl()}/login`,
        JSON.stringify({
          type: "m.login.password",
          identifier: { type: "m.id.user", user: iservUserId },
          password: this.session.getPassword(),
          device_id: `ISERV-CLIENT-${iservUserId}`,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
      const matrixData = parseJson<Record<string, unknown>>(matrixLoginRes.data, "matrix login");
      const matrixToken = (matrixData?.access_token as string) ?? null;
      const matrixUserId = (matrixData?.user_id as string) ?? undefined;
      if (!matrixToken) throw new IServAuthError("Login failed! Could not retrieve Matrix token.");
      this.session.setMatrixToken(matrixToken, matrixUserId);

      log.info("Login successful");
    } catch (err) {
      if (err instanceof IServAuthError) throw err;
      const message = err instanceof Error ? err.message : "Unknown connection error";
      throw new IServAuthError(`Connection error: ${message}`);
    }
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
