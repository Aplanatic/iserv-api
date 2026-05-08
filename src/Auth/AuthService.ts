import { IServAuthError } from "../Core/Errors.js";
import type { IServSession } from "../Core/IServSession.js";
import { createLogger } from "../Core/Logger.js";

const log = createLogger("Auth");

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
