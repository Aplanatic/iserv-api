import type { SerializedCookieJar } from "tough-cookie";
import { type AuthChallengeHandler, AuthService } from "../Auth/AuthService.js";
import { CalendarService } from "../Calendar/CalendarService.js";
import { CapabilityService } from "../Capabilities/CapabilityService.js";
import { ConferenceService } from "../Conference/ConferenceService.js";
import { EmailService } from "../Email/EmailService.js";
import { FilesService } from "../Files/FilesService.js";
import { MessengerService } from "../Messenger/MessengerService.js";
import { ModulePageService } from "../Modules/ModulePageService.js";
import { NotificationService } from "../Notifications/NotificationService.js";
import { routeCatalog } from "../Routes/RouteCatalog.js";
import { TimetableService } from "../Timetable/TimetableService.js";
import { UserService } from "../User/UserService.js";
import { IServApiError } from "./Errors.js";
import type { HtmlExtractedData } from "./HtmlSummary.js";
import { isHtmlResponse, summarizeHtml } from "./HtmlSummary.js";
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
  if (extracted.title) parts.push(extracted.title);
  if (extracted.emptyMessage) parts.push(extracted.emptyMessage);
  if (extracted.items?.length) parts.push(`${extracted.items.length} items`);
  for (const table of extracted.tables) {
    parts.push(`Table${table.caption ? ` "${table.caption}"` : ""}: ${table.rows.length} rows`);
  }
  if (extracted.keyValues && Object.keys(extracted.keyValues).length > 0) {
    parts.push(`${Object.keys(extracted.keyValues).length} fields`);
  }
  return parts.join(" · ");
}

function buildJsonSummary(parsed: unknown): string | undefined {
  if (Array.isArray(parsed)) return `${parsed.length} items`;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.items)) return `${obj.items.length} items`;
    if (Array.isArray(obj.rows)) return `${obj.rows.length} rows`;
    if (obj.title && typeof obj.title === "string") return obj.title;
    const keys = Object.keys(obj);
    if (keys.length <= 10) return undefined;
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
  readonly timetable: TimetableService;
  readonly modules: ModulePageService;

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
    this.timetable = new TimetableService(session);
    this.modules = new ModulePageService(session);
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

  /**
   * Prefer dedicated structured loaders over raw HTML extraction for known modules.
   */
  private async loadStructured(
    routeId: string,
    parameters: Record<string, string | number | boolean>,
  ): Promise<unknown | undefined> {
    switch (routeId) {
      case "timetable.overview": {
        const startDate =
          typeof parameters.start === "string"
            ? parameters.start
            : typeof parameters.startDate === "string"
              ? parameters.startDate
              : undefined;
        return this.timetable.getWeek(startDate ? { startDate } : {});
      }
      case "timetable.today":
        return this.timetable.getToday(
          typeof parameters.date === "string" ? { date: parameters.date } : {},
        );
      case "exercise.list": {
        const search =
          typeof parameters["filter[search]"] === "string"
            ? parameters["filter[search]"]
            : typeof parameters.search === "string"
              ? parameters.search
              : undefined;
        return this.modules.listExercises(search ? { search } : {});
      }
      case "exercise.past":
        return this.modules.listPastExercises();
      case "news.list":
        return this.modules.listNews(
          typeof parameters.search === "string" ? { search: parameters.search } : {},
        );
      case "news.show":
        if (typeof parameters.id === "string" || typeof parameters.id === "number") {
          return this.modules.showNews(String(parameters.id));
        }
        return undefined;
      case "forums.list":
        return this.modules.listForums();
      case "poll.list":
        return this.modules.listPolls();
      case "etherpad.list":
        return this.modules.listEtherpads();
      case "mailing_lists.list":
        return this.modules.listMailingLists();
      case "groupview.overview":
        return this.modules.listGroups();
      case "course_selection.list":
        return this.modules.listCourseSelections();
      case "print.overview":
        return this.modules.listPrintJobs();
      case "office.overview":
        return this.modules.getOfficeInfo();
      case "account.settings":
        return this.modules.getAccountSettings();
      case "account.last_logins":
        return this.modules.getAccountLogins();
      case "account.info":
        return this.modules.getAccountInfoPage();
      case "help.overview":
        return this.modules.getHelpOverview();
      case "conference.health":
        return this.conference.getHealth();
      case "calendar.upcoming":
        return this.calendar.getUpcomingEvents();
      case "calendar.sources":
        return this.calendar.getEventSources();
      case "calendar.holidays": {
        const next =
          parameters.next === true || parameters.next === "true" || parameters.mode === "next";
        const nextLimit =
          typeof parameters.limit === "number"
            ? parameters.limit
            : typeof parameters.limit === "string"
              ? Number(parameters.limit)
              : undefined;
        const overview = await this.calendar.getHolidays(
          nextLimit !== undefined && !Number.isNaN(nextLimit) ? { nextLimit } : {},
        );
        return { ...overview, mode: next ? "next" : "seasons" };
      }
      case "notifications.list":
        return this.notifications.getAll();
      case "notifications.badges":
        return this.notifications.getBadges();
      case "files.quota":
        return this.files.getDiskSpace();
      case "account.get":
      case "profile.get":
        return this.users.getOwnInfo();
      default:
        return undefined;
    }
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
      (route.status !== "supported" && route.status !== "experimental")
    ) {
      throw new Error(`Route ${routeId} is not eligible for the read-only executor`);
    }

    const startedAt = performance.now();

    // Prefer structured loaders
    try {
      const structured = await this.loadStructured(routeId, parameters);
      if (structured !== undefined) {
        const redacted = redactValue(structured);
        const summary = buildJsonSummary(structured);
        return {
          routeId,
          status: 200,
          durationMs: Math.round(performance.now() - startedAt),
          data: redacted,
          ...(summary ? { _summary: summary } : {}),
        };
      }
    } catch (error) {
      // Keep client validation / not-found errors instead of falling through to raw HTML
      if (error instanceof IServApiError) throw error;
      // Fall through to generic HTML/JSON path for unexpected structured failures
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
      // Prefer compact projection for CLI/MCP
      data = projectExtracted(extracted);
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
    return {
      routeId,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      data: redactValue(data),
      ...(summary ? { _summary: summary } : {}),
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

/** Compact projection: drop empty chrome fields from HtmlExtractedData. */
function projectExtracted(extracted: HtmlExtractedData): unknown {
  const out: Record<string, unknown> = {
    title: extracted.title,
  };
  if (extracted.emptyMessage) out.message = extracted.emptyMessage;
  if (extracted.items?.length) out.items = extracted.items;
  if (extracted.tables.length === 1) {
    out.headers = extracted.tables[0]!.headers;
    out.rows = extracted.tables[0]!.rows;
  } else if (extracted.tables.length > 1) {
    out.tables = extracted.tables.map((t) => ({
      ...(t.caption ? { caption: t.caption } : {}),
      headers: t.headers,
      rows: t.rows,
    }));
  }
  if (Object.keys(extracted.keyValues).length) out.fields = extracted.keyValues;
  if (extracted.lists.length) out.lists = extracted.lists;
  if (extracted.sections.length) {
    out.sections = extracted.sections.map((s) => ({
      heading: s.heading,
      ...(s.content.length ? { content: s.content } : {}),
    }));
  }
  // If almost empty, keep a clear empty message
  if (!out.items && !out.rows && !out.tables && !out.fields && !out.lists && !out.message) {
    out.message = "No structured content found on this page.";
  }
  return out;
}
