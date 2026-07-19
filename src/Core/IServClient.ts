import type { SerializedCookieJar } from "tough-cookie";
import { type AuthChallengeHandler, AuthService } from "../Auth/AuthService.js";
import { CalendarService } from "../Calendar/CalendarService.js";
import { ConferenceService } from "../Conference/ConferenceService.js";
import { EmailService } from "../Email/EmailService.js";
import { FilesService } from "../Files/FilesService.js";
import { MessengerService } from "../Messenger/MessengerService.js";
import { NotificationService } from "../Notifications/NotificationService.js";
import { routeCatalog } from "../Routes/RouteCatalog.js";
import { UserService } from "../User/UserService.js";
import { parseJson } from "./HttpClient.js";
import { IServSession } from "./IServSession.js";
import { redactValue } from "./Redaction.js";

export interface StoredSession {
  hostname: string;
  username: string;
  password?: string;
  cookies: SerializedCookieJar;
}

export class IServAPI {
  readonly calendar: CalendarService;
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
    return new IServAPI(session);
  }

  exportSession(options: { includePassword?: boolean } = {}): StoredSession {
    const result: StoredSession = {
      hostname: this.session.url,
      username: this.session.username,
      cookies: this.session.serializeCookies(),
    };
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

  async executeReadRoute(
    routeId: string,
    parameters: Record<string, string | number | boolean> = {},
  ): Promise<{ routeId: string; status: number; durationMs: number; data: unknown }> {
    const route = routeCatalog.get(routeId);
    if (
      route.method !== "GET" ||
      route.sideEffect !== "read" ||
      route.authentication !== "session"
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
    let data: unknown = response.data;
    try {
      data = parseJson(response.data, routeId);
    } catch {
      // HTML and text responses remain text and are still redacted.
    }
    return {
      routeId,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      data: redactValue(data),
    };
  }

  async disconnect(): Promise<void> {
    await this.auth.logout();
  }
}
