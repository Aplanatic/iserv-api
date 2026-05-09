import { parseJson } from "../Core/HttpClient.js";
import type { IServSession } from "../Core/IServSession.js";
import type {
  MatrixSyncResponse,
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
}
