import { parseJson } from "../Core/HttpClient.js";
import type { IServSession } from "../Core/IServSession.js";
import { createLogger } from "../Core/Logger.js";

const log = createLogger("MessengerService");
import type {
  MatrixMessagesResponse,
  MatrixSyncResponse,
  Message,
  MessagesResult,
  Room,
} from "./MessengerTypes.js";

const SYNC_FILTER = JSON.stringify({
  room: { timeline: { limit: 1 }, state: { lazy_load_members: true } },
});

export class MessengerService {
  constructor(private readonly session: IServSession) {}

  private authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.session.matrixToken}` };
  }

  async getRooms(): Promise<Room[]> {
    const res = await this.session.http.get(`${this.session.matrixBaseUrl()}/sync`, {
      params: { filter: SYNC_FILTER, timeout: 0 },
      headers: this.authHeader(),
    });

    const sync = parseJson<MatrixSyncResponse>(res.data, "sync");
    const joinedRooms = sync.rooms?.join ?? {};

    const directRoomIds = new Set<string>();
    for (const event of sync.account_data?.events ?? []) {
      if (event.type === "m.direct") {
        for (const roomIds of Object.values(event.content) as string[][]) {
          for (const id of roomIds) directRoomIds.add(id);
        }
      }
    }

    return Object.entries(joinedRooms).map(([roomId, room]) => {
      const nameEvent = room.state.events.find((e) => e.type === "m.room.name");
      const name = (nameEvent?.content.name as string | undefined) ?? roomId;

      const messageEvents = room.timeline.events.filter(
        (e) => e.type === "m.room.message" || e.type === "m.room.encrypted",
      );
      const lastEvent = messageEvents.at(-1) ?? null;
      const lastMessage = lastEvent
        ? {
            body:
              lastEvent.type === "m.room.encrypted"
                ? "[Encrypted message]"
                : (lastEvent.content.body as string) ?? "",
            sender: lastEvent.sender ?? "",
            timestamp: lastEvent.origin_server_ts ?? 0,
          }
        : null;

      return {
        id: roomId,
        name,
        lastMessage,
        unreadCount: room.unread_notifications?.notification_count ?? 0,
        isDirect: directRoomIds.has(roomId),
      };
    });
  }

  async getMessages(
    roomId: string,
    options: { limit?: number; from?: string } = {},
  ): Promise<MessagesResult> {
    const { limit = 30, from } = options;
    const encodedRoomId = encodeURIComponent(roomId);
    const filter = JSON.stringify({ lazy_load_members: true });

    const params: Record<string, string | number | boolean> = { limit, dir: "b", filter };
    if (from) params.from = from;

    const res = await this.session.http.get(
      `${this.session.matrixBaseUrl()}/rooms/${encodedRoomId}/messages`,
      { params, headers: this.authHeader() },
    );

    const data = parseJson<MatrixMessagesResponse>(res.data, `messages for ${roomId}`);

    const messages: Message[] = data.chunk
      .filter((e) => e.type === "m.room.message" || e.type === "m.room.encrypted")
      .map((e) => ({
        eventId: e.event_id ?? "",
        sender: e.sender ?? "",
        body: e.type === "m.room.encrypted" ? "" : (e.content.body as string) ?? "",
        msgtype: e.type === "m.room.encrypted" ? "m.encrypted" : (e.content.msgtype as string) ?? "",
        timestamp: e.origin_server_ts ?? 0,
        encrypted: e.type === "m.room.encrypted",
      }));

    log.info(`Got ${messages.length} messages for ${roomId}`);
    return { messages, start: data.start, end: data.end };
  }
}
