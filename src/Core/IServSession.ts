import { CookieJar, type SerializedCookieJar } from "tough-cookie";
import { createHttpClient, type HttpClient } from "./HttpClient.js";
import { normalizeInstanceUrl } from "./InstanceUrl.js";

const passwords = new WeakMap<IServSession, string>();

export class IServSession {
  readonly url: string;
  readonly username: string;
  readonly http: HttpClient;
  readonly cookieJar: CookieJar;

  constructor(url: string, username: string, password: string, cookies?: SerializedCookieJar) {
    this.url = normalizeInstanceUrl(url).hostname;
    this.username = username;
    this.cookieJar = cookies ? CookieJar.deserializeSync(cookies) : new CookieJar();
    this.http = createHttpClient(this.cookieJar);
    passwords.set(this, password);
  }

  matrixToken: string | null = null;
  matrixUserId: string | null = null;

  setMatrixToken(token: string, userId?: string): void {
    this.matrixToken = token;
    if (userId) this.matrixUserId = userId;
  }

  matrixBaseUrl(): string {
    return `https://${this.url}/_matrix/client/v3`;
  }

  hasPassword(): boolean {
    const pw = passwords.get(this);
    return typeof pw === "string" && pw.length > 0;
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

  serializeCookies(): SerializedCookieJar {
    const serialized = this.cookieJar.serializeSync();
    if (!serialized) throw new Error("Unable to serialize the IServ cookie jar");
    return serialized;
  }
}
