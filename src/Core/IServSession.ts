import { CookieJar } from "tough-cookie";
import { createHttpClient, type HttpClient } from "./HttpClient.js";

const passwords = new WeakMap<IServSession, string>();

export class IServSession {
  readonly http: HttpClient;
  readonly cookieJar: CookieJar;

  constructor(
    readonly url: string,
    readonly username: string,
    password: string,
  ) {
    if (!/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/.test(url)) {
      throw new Error(`Invalid IServ URL: "${url}"`);
    }
    this.cookieJar = new CookieJar();
    this.http = createHttpClient(this.cookieJar);
    passwords.set(this, password);
  }

  matrixToken: string | null = null;

  setMatrixToken(token: string): void {
    this.matrixToken = token;
  }

  matrixBaseUrl(): string {
    return `https://${this.url}/_matrix/client/v3`;
  }

  getPassword(): string {
    const pw = passwords.get(this);
    if (pw === undefined) throw new Error("Session password unavailable");
    return pw;
  }

  baseUrl(): string {
    return `https://${this.url}`;
  }

  clearSession(): void {
    this.cookieJar.removeAllCookiesSync();
  }
}
