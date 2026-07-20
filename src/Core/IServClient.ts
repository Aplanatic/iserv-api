import type { SerializedCookieJar } from "tough-cookie";
import { type AuthChallengeHandler, AuthService } from "../Auth/AuthService.js";
import { CalendarService } from "../Calendar/CalendarService.js";
import { CapabilityService } from "../Capabilities/CapabilityService.js";
import { ConferenceService } from "../Conference/ConferenceService.js";
import { EmailService } from "../Email/EmailService.js";
import { FilesService } from "../Files/FilesService.js";
import { MessengerService } from "../Messenger/MessengerService.js";
import { NotificationService } from "../Notifications/NotificationService.js";
import { routeCatalog } from "../Routes/RouteCatalog.js";
import { UserService } from "../User/UserService.js";
import { isHtmlResponse, summarizeHtml } from "./HtmlSummary.js";
import type { HtmlExtractedData } from "./HtmlSummary.js";
import { parseJson } from "./HttpClient.js";
import { IServSession } from "./IServSession.js";
import { redactValue } from "./Redaction.js";

export interface StoredSession {
  hostname: string;
  username: string;
  password?: string;
  cookies: SerializedCookieJar;
  matrixToken?: string;
  matrixUserId?: string;
}

export interface ReadRouteRequest {
  routeId: string;
  parameters?: Record<string, string | number | boolean>;
}

export interface ReadRouteResult {
  routeId: string;
  status: number;
  durationMs: number;
  data: unknown;
  _summary?: string;
}

function buildHtmlSummary(extracted: HtmlExtractedData): string {
  const parts: string[] = [];
  if (extracted.title) parts.push(`Page: ${extracted.title}`);
  if (extracted.sections.length > 0) {
    const headings = extracted.sections.map((s) => s.heading);
    parts.push(`Sections: ${headings.join(", ")}`);
  }
  if (extracted.keyValues && Object.keys(extracted.keyValues).length > 0) {
    const kvs = Object.entries(extracted.keyValues)
      .slice(0, 5)
      .map(([k, v]) => `${k}=${v.length > 40 ? v.slice(0, 40) + "..." : v}`);
    parts.push(`Fields: ${kvs.join(", ")}`);
  }
  for (const table of extracted.tables) {
    parts.push(
      `Table${table.caption ? ` "${table.caption}"` : ""}: ${table.rows.length} rows`,
    );
  }
  if (extracted.links.length > 0) parts.push(`${extracted.links.length} links`);
  return parts.join(" | ");
}

function buildJsonSummary(parsed: unknown): string | undefined {
  if (Array.isArray(parsed)) {
    return `${parsed.length} items`;
  }
  if (parsed && typeof parsed === "object") {
    const keys = Object.keys(parsed as Record<string, unknown>);
    if (keys.length <= 10) return undefined; // show directly
    return `${keys.length} fields`;
  }
  return undefined;
}

export class IServAPI {
  readonly calendar: CalendarService;
  readonly capabilities: CapabilityService;
  readonly email: EmailService;
  readonly users: UserService;
  readonly notifications: NotificationService;
  readonly files: FilesService;
  readonly conference: ConferenceService;
  readonly messenger: MessengerService;

  private readonly auth: AuthService;
  private readonly session: IServSession;

  private constructor(session: IServSession, challengeHandler?: AuthChallengeHandler) {
    this.session = session;
    this.auth = new AuthService(session, challengeHandler);
    this.calendar = new CalendarService(session);
    this.capabilities = new CapabilityService(session);
    this.email = new EmailService(session);
    this.users = new UserService(session);
    this.notifications = new NotificationService(session);
    this.files = new FilesService(session);
    this.conference = new ConferenceService(session);
    this.messenger = new MessengerService(session);
  }

  static async connect(
    url: string,
    username: string,
    password: string,
    options: { challengeHandler?: AuthChallengeHandler } = {},
  ): Promise<IServAPI> {
    const session = new IServSession(url, username, password);
    const client = new IServAPI(session, options.challengeHandler);
    await client.auth.login();
    return client;
  }

  static restore(stored: StoredSession): IServAPI {
    const session = new IServSession(
      stored.hostname,
      stored.username,
      stored.password ?? "",
      stored.cookies,
    );
    if (stored.matrixToken) session.setMatrixToken(stored.matrixToken, stored.matrixUserId);
    return new IServAPI(session);
  }

  exportSession(options: { includePassword?: boolean } = {}): StoredSession {
    const result: StoredSession = {
      hostname: this.session.url,
      username: this.session.username,
      cookies: this.session.serializeCookies(),
    };
    if (this.session.matrixToken) result.matrixToken = this.session.matrixToken;
    if (this.session.matrixUserId) result.matrixUserId = this.session.matrixUserId;
    if (options.includePassword) result.password = this.session.getPassword();
    return result;
  }

  async validateSession(): Promise<boolean> {
    try {
      await this.users.getOwnInfo();
      return true;
    } catch {
      return false;
    }
  }

  async ensureMessengerSession(): Promise<void> {
    if (this.session.matrixToken) return;
    await this.auth.authenticateMessenger();
  }

  async executeReadRoute(
    routeId: string,
    parameters: Record<string, string | number | boolean> = {},
  ): Promise<ReadRouteResult> {
    const route = routeCatalog.get(routeId);
    if (
      route.method !== "GET" ||
      route.sideEffect !== "read" ||
      route.authentication !== "session" ||
      route.status !== "supported"
    ) {
      throw new Error(`Route ${routeId} is not eligible for the read-only executor`);
    }
    let path = route.path;
    const query: Record<string, string | number | boolean> = {};
    for (const parameter of route.parameters) {
      const value = parameters[parameter.name];
      if (parameter.required && value === undefined) {
        throw new Error(`Missing required parameter: ${parameter.name}`);
      }
      if (value === undefined) continue;
      if (parameter.location === "path") {
        path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
      } else if (parameter.location === "query") {
        query[parameter.name] = value;
      }
    }
    if (/\{[^}]+\}/.test(path)) throw new Error("Unresolved route path parameter");
    const startedAt = performance.now();
    const response = await this.session.http.get(`${this.session.baseUrl()}${path}`, {
      params: query,
    });
    const contentType = Array.isArray(response.headers["content-type"])
      ? response.headers["content-type"][0]
      : response.headers["content-type"];
    let data: unknown;
    let summary: string | undefined;
    if (isHtmlResponse(response.data, contentType)) {
      const extracted = summarizeHtml(response.data);
      data = extracted;
      summary = buildHtmlSummary(extracted);
    } else {
      try {
        const parsed = parseJson(response.data, routeId);
        data = parsed;
        summary = buildJsonSummary(parsed);
      } catch {
        data = "[redacted-non-json-response]";
      }
    }
    const redacted = redactValue(data);
    return {
      routeId,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      data: redacted,
      _summary: summary,
    };
  }

  async executeReadRoutes(
    requests: readonly ReadRouteRequest[],
    options: { concurrency?: number } = {},
  ): Promise<ReadRouteResult[]> {
    if (requests.length < 1 || requests.length > 8) {
      throw new Error("Read batches must contain between 1 and 8 routes");
    }
    const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));
    for (const request of requests) {
      const route = routeCatalog.get(request.routeId);
      if (
        route.method !== "GET" ||
        route.sideEffect !== "read" ||
        route.authentication !== "session" ||
        route.status !== "supported"
      ) {
        throw new Error(`Route ${request.routeId} is not eligible for the read-only executor`);
      }
    }
    const results = new Array<ReadRouteResult>(requests.length);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < requests.length) {
        const index = nextIndex++;
        const request = requests[index];
        if (!request) return;
        results[index] = await this.executeReadRoute(request.routeId, request.parameters ?? {});
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, requests.length) }, worker));
    return results;
  }

  async disconnect(): Promise<void> {
    await this.auth.logout();
  }
}
