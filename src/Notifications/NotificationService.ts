import { IServApiError } from "../Core/Errors.js";
import { type JsonValue, parseIServJsonData, parseJson } from "../Core/HttpClient.js";
import type { IServSession } from "../Core/IServSession.js";
import { createLogger } from "../Core/Logger.js";
import type { NavigationBadges, NotificationsData } from "./NotificationTypes.js";

const log = createLogger("Notifications");

export class NotificationService {
  constructor(private readonly session: IServSession) {}

  async getAll(): Promise<NotificationsData> {
    const res = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/user/api/notifications`,
    );
    log.info("Got notifications");
    return parseIServJsonData<NotificationsData>(res.data, "notifications");
  }

  async getBadges(): Promise<NavigationBadges & { fetchedAt: string }> {
    const res = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/app/navigation/badges`,
      {
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      },
    );
    log.info("Got badges");
    const badges = parseJson<NavigationBadges>(res.data, "navigation badges");
    return Object.assign({}, badges, {
      fetchedAt: new Date().toISOString(),
    }) as NavigationBadges & { fetchedAt: string };
  }

  async readAll(): Promise<JsonValue> {
    const res = await this.session.http.post(
      `${this.session.baseUrl()}/iserv/notification/api/v1/notifications/readall`,
    );
    log.info("Marked all notifications as read");
    return parseIServJsonData<JsonValue>(res.data, "read all notifications");
  }

  async read(id: number): Promise<JsonValue> {
    if (!Number.isInteger(id) || id <= 0) {
      throw new IServApiError("id must be a positive integer", 400);
    }
    const res = await this.session.http.post(
      `${this.session.baseUrl()}/iserv/notification/api/v1/notifications/${id}/read`,
    );
    log.info(`Marked notification ${id} as read`);
    return parseIServJsonData<JsonValue>(res.data, `read notification ${id}`);
  }
}
