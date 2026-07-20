import * as cheerio from "cheerio";
import { IServApiError } from "../Core/Errors.js";
import { parseJson } from "../Core/HttpClient.js";
import type { IServSession } from "../Core/IServSession.js";
import { createLogger } from "../Core/Logger.js";

const log = createLogger("MessengerService");

import type {
  CreateDirectMessageResult,
  ListenOptions,
  MatrixEvent,
  MatrixMemberEvent,
  MatrixMembersResponse,
  MatrixMessagesResponse,
  MatrixProfileResponse,
  MatrixSyncResponse,
  Member,
  Message,
  MessageEvent,
  MessageListener,
  MessagesResult,
  MessengerContact,
  Room,
  SendMessageResult,
  UserProfile,
} from "./MessengerTypes.js";

const SYNC_FILTER = JSON.stringify({
  room: { timeline: { limit: 1 } },
});

function shortMxid(userId: string): string {
  const match = userId.match(/^@([^:]+)/);
  const local = match?.[1] ?? userId.replace(/^@/, "");
  if (local.length <= 8) return `@${local}`;
  return `@${local.slice(0, 8)}…`;
}

function activityNote(messages: Message[], selfId: string | null): string | undefined {
  const fromOther = messages.filter((message) => message.sender !== selfId);
  if (fromOther.length === 0) return undefined;

  const media = fromOther.filter(
    (message) =>
      message.msgtype === "m.video" ||
      message.msgtype === "m.file" ||
      message.msgtype === "m.image" ||
      /\.(mp4|mov|webm|mkv|avi)(\b|$)/i.test(message.body),
  );
  const videos = media.filter(
    (message) =>
      message.msgtype === "m.video" || /video|\.(mp4|mov|webm|mkv|avi)(\b|$)/i.test(message.body),
  );
  if (videos.length > 0) {
    const year = new Date(videos[0]!.timestamp).getFullYear();
    if (!Number.isFinite(year) || year < 2000) return undefined;
    return videos.length === 1
      ? `hat dir ${year} ein Video geschickt`
      : `hat dir ${year} Videos geschickt`;
  }
  if (media.length > 0) {
    const year = new Date(media[0]!.timestamp).getFullYear();
    if (!Number.isFinite(year) || year < 2000) return undefined;
    return media.length === 1
      ? `hat dir ${year} eine Datei geschickt`
      : `hat dir ${year} Dateien geschickt`;
  }
  return undefined;
}

const LISTEN_FILTER = JSON.stringify({
  room: { timeline: { types: ["m.room.message"] } },
});

const AJAX_FORM_HEADERS = {
  Accept: "text/html, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
};

function isHttpError(error: unknown, statusCode: number): boolean {
  if (error instanceof IServApiError) return error.status === statusCode;
  return (
    error instanceof Error &&
    "response" in error &&
    typeof (error as { response: unknown }).response === "object" &&
    (error as { response: { statusCode: number } }).response?.statusCode === statusCode
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export class MessengerService {
  constructor(private readonly session: IServSession) {}

  private authHeader(): Record<string, string> {
    if (!this.session.matrixToken) throw new Error("Not authenticated: Matrix token is missing");
    return { Authorization: `Bearer ${this.session.matrixToken}` };
  }

  private buildNameMap(events: MatrixEvent[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const e of events) {
      if (e.type === "m.room.member" && e.state_key) {
        const displayname = e.content.displayname as string | undefined;
        if (displayname) map.set(e.state_key, displayname);
      }
    }
    return map;
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

    const selfId = this.session.matrixUserId;

    const rooms = Object.entries(joinedRooms).map(([roomId, room]) => {
      const nameEvent = room.state.events.find((e) => e.type === "m.room.name");
      let name = (nameEvent?.content.name as string | undefined) ?? null;

      if (!name) {
        const memberEvents = room.state.events.filter((e) => e.type === "m.room.member");
        const other = memberEvents.find(
          (e) => e.state_key !== selfId && e.content.membership === "join",
        );
        name = (other?.content.displayname as string | undefined) ?? roomId;
      }

      const nameById = this.buildNameMap(room.state.events);

      const messageEvents = room.timeline.events.filter(
        (e) => e.type === "m.room.message" || e.type === "m.room.encrypted",
      );
      const lastEvent = messageEvents.at(-1) ?? null;
      const lastMessage = lastEvent
        ? {
            body:
              lastEvent.type === "m.room.encrypted"
                ? "[Encrypted message]"
                : ((lastEvent.content.body as string) ?? ""),
            sender: lastEvent.sender ?? "",
            senderName: nameById.get(lastEvent.sender ?? "") ?? lastEvent.sender ?? "",
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

    // Resolve DM display names when sync state omitted member events (name === room id)
    const directUserByRoom = new Map<string, string>();
    for (const event of sync.account_data?.events ?? []) {
      if (event.type !== "m.direct") continue;
      for (const [userId, roomIds] of Object.entries(event.content as Record<string, string[]>)) {
        for (const roomId of roomIds ?? []) directUserByRoom.set(roomId, userId);
      }
    }

    await Promise.all(
      rooms.map(async (room) => {
        if (room.name !== room.id && !room.name.startsWith("!")) return;
        try {
          const members = await this.getMembers(room.id);
          const other = members.find(
            (member) =>
              member.userId !== selfId && member.membership === "join" && member.displayName,
          );
          if (other?.displayName) {
            room.name = other.displayName;
            return;
          }
        } catch {
          /* fall through */
        }
        const userId = directUserByRoom.get(room.id);
        if (!userId) return;
        try {
          const profile = await this.getProfile(userId);
          if (profile.displayName) room.name = profile.displayName;
        } catch {
          /* keep matrix id */
        }
      }),
    );

    return rooms;
  }

  /**
   * Resolve Matrix DM contacts from m.direct → real display names (+ activity notes).
   */
  async getContacts(): Promise<MessengerContact[]> {
    const res = await this.session.http.get(`${this.session.matrixBaseUrl()}/sync`, {
      params: { filter: SYNC_FILTER, timeout: 0 },
      headers: this.authHeader(),
    });
    const sync = parseJson<MatrixSyncResponse>(res.data, "sync");
    const selfId = this.session.matrixUserId;
    const joined = new Set(Object.keys(sync.rooms?.join ?? {}));

    const direct = new Map<string, string[]>();
    for (const event of sync.account_data?.events ?? []) {
      if (event.type !== "m.direct") continue;
      for (const [userId, roomIds] of Object.entries(event.content as Record<string, string[]>)) {
        direct.set(userId, Array.isArray(roomIds) ? roomIds : []);
      }
    }

    const contacts = await Promise.all(
      [...direct.entries()].map(async ([userId, roomIds]) => {
        let name = "???";
        try {
          const profile = await this.getProfile(userId);
          if (profile.displayName?.trim()) name = profile.displayName.trim();
        } catch {
          /* keep ??? */
        }

        const roomId = roomIds.find((id) => joined.has(id)) ?? roomIds.find(Boolean) ?? null;

        let note: string | undefined;
        let lastActiveAt: number | undefined;
        if (roomId && joined.has(roomId)) {
          try {
            const { messages } = await this.getMessages(roomId, { limit: 30 });
            note = activityNote(messages, selfId);
            lastActiveAt = messages[0]?.timestamp;
          } catch {
            /* no note */
          }
        }

        return {
          userId,
          shortId: shortMxid(userId),
          name,
          roomId,
          ...(note ? { note } : {}),
          ...(lastActiveAt ? { lastActiveAt } : {}),
        } satisfies MessengerContact;
      }),
    );

    contacts.sort((a, b) => {
      const aActive = a.roomId && a.lastActiveAt ? 1 : a.roomId ? 0 : -1;
      const bActive = b.roomId && b.lastActiveAt ? 1 : b.roomId ? 0 : -1;
      if (aActive !== bActive) return bActive - aActive;
      if ((b.lastActiveAt ?? 0) !== (a.lastActiveAt ?? 0)) {
        return (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
      }
      return a.name.localeCompare(b.name, "de");
    });

    log.info(`Got ${contacts.length} messenger contacts`);
    return contacts;
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

    const data = parseJson<MatrixMessagesResponse>(res.data, "messages");

    const nameById = this.buildNameMap(data.state ?? []);

    const messages: Message[] = data.chunk
      .filter((e) => e.type === "m.room.message" || e.type === "m.room.encrypted")
      .map((e) => ({
        eventId: e.event_id ?? "",
        sender: e.sender ?? "",
        senderName: nameById.get(e.sender ?? "") ?? e.sender ?? "",
        body: e.type === "m.room.encrypted" ? "" : ((e.content.body as string) ?? ""),
        msgtype:
          e.type === "m.room.encrypted" ? "m.encrypted" : ((e.content.msgtype as string) ?? ""),
        timestamp: e.origin_server_ts ?? 0,
        encrypted: e.type === "m.room.encrypted",
      }));

    log.debug(`Got ${messages.length} messages`);
    return { messages, start: data.start, end: data.end };
  }

  async sendMessage(
    roomId: string,
    body: string,
    txnId: string = crypto.randomUUID(),
  ): Promise<SendMessageResult> {
    const encodedRoomId = encodeURIComponent(roomId);
    const encodedTxnId = encodeURIComponent(txnId);

    const res = await this.session.http.put(
      `${this.session.matrixBaseUrl()}/rooms/${encodedRoomId}/send/m.room.message/${encodedTxnId}`,
      JSON.stringify({ msgtype: "m.text", body }),
      { headers: { ...this.authHeader(), "Content-Type": "application/json" } },
    );

    const data = parseJson<{ event_id: string }>(res.data, "sendMessage");

    log.debug("Sent message");
    return { eventId: data.event_id };
  }

  async leaveRoom(roomId: string): Promise<void> {
    const encodedRoomId = encodeURIComponent(roomId);

    await this.session.http.post(
      `${this.session.matrixBaseUrl()}/rooms/${encodedRoomId}/leave`,
      JSON.stringify({}),
      {
        headers: {
          ...this.authHeader(),
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: this.session.baseUrl(),
        },
      },
    );

    log.debug("Left room");
  }

  async reactToMessage(
    roomId: string,
    eventId: string,
    emoji: string,
    txnId: string = crypto.randomUUID(),
  ): Promise<SendMessageResult> {
    const encodedRoomId = encodeURIComponent(roomId);
    const encodedTxnId = encodeURIComponent(txnId);

    const res = await this.session.http.put(
      `${this.session.matrixBaseUrl()}/rooms/${encodedRoomId}/send/m.reaction/${encodedTxnId}`,
      JSON.stringify({
        "m.relates_to": { rel_type: "m.annotation", event_id: eventId, key: emoji },
      }),
      { headers: { ...this.authHeader(), "Content-Type": "application/json" } },
    );

    const data = parseJson<{ event_id: string }>(res.data, "reactToMessage");

    log.debug("Reacted to message");
    return { eventId: data.event_id };
  }

  async createDirectMessage(matrixId: string): Promise<CreateDirectMessageResult> {
    const ownUserId = this.session.matrixUserId;
    if (ownUserId) {
      const ownUuid = ownUserId.replace(/^@/, "").split(":")[0] ?? "";
      if (matrixId.includes(ownUuid)) {
        throw new IServApiError("Cannot create a direct message room with yourself", 400);
      }
    }

    const url = `${this.session.baseUrl()}/iserv/messenger/form/directmessage/create`;
    const origin = this.session.baseUrl();

    const formRes = await this.session.http.get(url, { headers: AJAX_FORM_HEADERS });
    const $ = cheerio.load(formRes.data as string);
    const form = $("form").first();
    const formRoot = form.length ? form : $("body");
    const token = formValue(
      formRoot.find('[name="directmessage[_token]"]').first().val() ??
        $("#directmessage__token").val(),
    );
    if (!token) throw new Error("Could not retrieve CSRF token for direct message creation");

    const formData = new URLSearchParams([
      ["directmessage[matrix_id]", matrixId],
      ["directmessage[_token]", token],
      ["directmessage[submit]", ""],
    ]);

    const action = form.attr("action");
    const postUrl = action ? new URL(action, url).toString() : url;

    const res = await this.session.http.post(postUrl, formData.toString(), {
      headers: {
        ...AJAX_FORM_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: origin,
      },
    });

    const data = parseJson<{ room_id: string }>(res.data, "createDirectMessage");
    if (!data.room_id) throw new Error("createDirectMessage: response did not include room_id");
    log.debug("Created direct message room");
    return { roomId: data.room_id };
  }

  async editMessage(
    roomId: string,
    eventId: string,
    newBody: string,
    txnId: string = crypto.randomUUID(),
  ): Promise<SendMessageResult> {
    const encodedRoomId = encodeURIComponent(roomId);
    const encodedTxnId = encodeURIComponent(txnId);

    const res = await this.session.http.put(
      `${this.session.matrixBaseUrl()}/rooms/${encodedRoomId}/send/m.room.message/${encodedTxnId}`,
      JSON.stringify({
        msgtype: "m.text",
        body: ` * ${newBody}`,
        "m.relates_to": { rel_type: "m.replace", event_id: eventId },
        "m.new_content": { msgtype: "m.text", body: newBody },
      }),
      { headers: { ...this.authHeader(), "Content-Type": "application/json" } },
    );

    const data = parseJson<{ event_id: string }>(res.data, "editMessage");
    log.debug("Edited message");
    return { eventId: data.event_id };
  }

  async replyToMessage(
    roomId: string,
    replyTo: { eventId: string; sender: string; body: string },
    replyBody: string,
    txnId: string = crypto.randomUUID(),
  ): Promise<SendMessageResult> {
    const encodedRoomId = encodeURIComponent(roomId);
    const encodedTxnId = encodeURIComponent(txnId);

    const plainBody = `> <${replyTo.sender}> ${replyTo.body}\n\n${replyBody}`;
    const roomLink = `https://matrix.to/#/${escapeHtml(roomId)}/${escapeHtml(replyTo.eventId)}`;
    const senderLink = `https://matrix.to/#/${escapeHtml(replyTo.sender)}`;
    const formattedBody =
      `<mx-reply><blockquote>` +
      `<a href="${roomLink}">In reply to</a>` +
      `<a href="${senderLink}">${escapeHtml(replyTo.sender)}</a>` +
      `<br>${escapeHtml(replyTo.body)}</blockquote></mx-reply>${escapeHtml(replyBody)}`;

    const res = await this.session.http.put(
      `${this.session.matrixBaseUrl()}/rooms/${encodedRoomId}/send/m.room.message/${encodedTxnId}`,
      JSON.stringify({
        msgtype: "m.text",
        format: "org.matrix.custom.html",
        body: plainBody,
        formatted_body: formattedBody,
        "m.relates_to": { "m.in_reply_to": { event_id: replyTo.eventId } },
      }),
      { headers: { ...this.authHeader(), "Content-Type": "application/json" } },
    );

    const data = parseJson<{ event_id: string }>(res.data, "replyToMessage");
    log.debug("Replied to message");
    return { eventId: data.event_id };
  }

  private async redactEvent(
    roomId: string,
    eventId: string,
    txnId: string,
    notFoundMessage: string,
    forbiddenMessage: string,
  ): Promise<SendMessageResult> {
    const encodedRoomId = encodeURIComponent(roomId);
    const encodedEventId = encodeURIComponent(eventId);
    const encodedTxnId = encodeURIComponent(txnId);

    try {
      const res = await this.session.http.put(
        `${this.session.matrixBaseUrl()}/rooms/${encodedRoomId}/redact/${encodedEventId}/${encodedTxnId}`,
        JSON.stringify({}),
        { headers: { ...this.authHeader(), "Content-Type": "application/json" } },
      );
      const data = parseJson<{ event_id: string }>(res.data, "redactEvent");
      return { eventId: data.event_id };
    } catch (error) {
      if (isHttpError(error, 404)) throw new Error(notFoundMessage);
      if (isHttpError(error, 403)) throw new Error(forbiddenMessage);
      throw error;
    }
  }

  async removeReaction(
    roomId: string,
    reactionEventId: string,
    txnId: string = crypto.randomUUID(),
  ): Promise<SendMessageResult> {
    const result = await this.redactEvent(
      roomId,
      reactionEventId,
      txnId,
      `Reaction "${reactionEventId}" not found — it may have already been removed`,
      `Not authorized to remove reaction "${reactionEventId}"`,
    );
    log.debug("Removed reaction");
    return result;
  }

  async deleteMessage(
    roomId: string,
    eventId: string,
    txnId: string = crypto.randomUUID(),
  ): Promise<SendMessageResult> {
    const result = await this.redactEvent(
      roomId,
      eventId,
      txnId,
      `Message "${eventId}" not found, it may have already been deleted`,
      `Not authorized to delete message "${eventId}"`,
    );
    log.debug("Deleted message");
    return result;
  }

  async reactToMessageByName(
    name: string,
    eventId: string,
    emoji: string,
    txnId: string = crypto.randomUUID(),
  ): Promise<SendMessageResult> {
    const rooms = await this.getRooms();
    const matches = rooms.filter((r) => r.name.toLowerCase() === name.toLowerCase());

    if (matches.length === 0) throw new Error(`No room found with name "${name}"`);
    if (matches.length > 1)
      throw new Error(
        `Multiple rooms found with name "${name}", use reactToMessage() with a room ID`,
      );

    const roomId = matches[0]?.id;
    if (!roomId) throw new Error(`No room found with name "${name}"`);
    return this.reactToMessage(roomId, eventId, emoji, txnId);
  }

  async sendMessageByName(
    name: string,
    body: string,
    txnId: string = crypto.randomUUID(),
  ): Promise<SendMessageResult> {
    const rooms = await this.getRooms();
    const matches = rooms.filter((r) => r.name.toLowerCase() === name.toLowerCase());

    if (matches.length === 0) throw new Error(`No room found with name "${name}"`);
    if (matches.length > 1)
      throw new Error(
        `Multiple rooms found with name "${name}" — use sendMessage() with a room ID`,
      );

    const roomId = matches[0]?.id;
    if (!roomId) throw new Error(`No room found with name "${name}"`);
    return this.sendMessage(roomId, body, txnId);
  }

  async getMembers(roomId: string): Promise<Member[]> {
    const encodedRoomId = encodeURIComponent(roomId);

    const res = await this.session.http.get(
      `${this.session.matrixBaseUrl()}/rooms/${encodedRoomId}/members`,
      { params: { not_membership: "leave" }, headers: this.authHeader() },
    );

    const data = parseJson<MatrixMembersResponse>(res.data, "members");

    log.debug(`Got ${data.chunk.length} members`);
    return data.chunk.map((e: MatrixMemberEvent) => ({
      userId: e.state_key,
      displayName: e.content.displayname ?? null,
      avatarUrl: e.content.avatar_url ?? null,
      membership: e.content.membership as "join" | "invite",
    }));
  }

  async getMessagesByName(
    name: string,
    options: { limit?: number; from?: string } = {},
  ): Promise<MessagesResult> {
    const rooms = await this.getRooms();
    const matches = rooms.filter((r) => r.name.toLowerCase() === name.toLowerCase());

    if (matches.length === 0) throw new Error(`No room found with name "${name}"`);
    if (matches.length > 1)
      throw new Error(
        `Multiple rooms found with name "${name}" — use getMessages() with a room ID`,
      );

    const roomId = matches[0]?.id;
    if (!roomId) throw new Error(`No room found with name "${name}"`);
    return this.getMessages(roomId, options);
  }

  async getProfile(userId: string): Promise<UserProfile> {
    const encodedUserId = encodeURIComponent(userId);

    const res = await this.session.http.get(
      `${this.session.matrixBaseUrl()}/profile/${encodedUserId}`,
      { headers: this.authHeader() },
    );

    const data = parseJson<MatrixProfileResponse>(res.data, "profile");

    log.debug("Got messenger profile");
    return {
      userId,
      displayName: data.displayname ?? null,
      avatarUrl: data.avatar_url ?? null,
    };
  }

  async listenForMessages(
    callback: (event: MessageEvent, stop: () => void) => void | Promise<void>,
    options: ListenOptions = {},
  ): Promise<MessageListener> {
    const { pollTimeout = 30000, roomIds, onError } = options;
    let stopped = false;
    const startedAt = Date.now();

    const initRes = await this.session.http.get(`${this.session.matrixBaseUrl()}/sync`, {
      params: { timeout: 0 },
      headers: this.authHeader(),
    });
    const initSync = parseJson<MatrixSyncResponse>(initRes.data, "listenForMessages:init");
    let since = initSync.next_batch;

    const roomNames = new Map<string, string>();
    const memberNames = new Map<string, Map<string, string>>();
    for (const [roomId, room] of Object.entries(initSync.rooms?.join ?? {})) {
      const nameEvent = room.state.events.find((e) => e.type === "m.room.name");
      const name = nameEvent?.content.name as string | undefined;
      if (name) roomNames.set(roomId, name);
      memberNames.set(roomId, this.buildNameMap(room.state.events));
    }

    const loop = async () => {
      while (!stopped) {
        try {
          const res = await this.session.http.get(`${this.session.matrixBaseUrl()}/sync`, {
            params: { filter: LISTEN_FILTER, timeout: pollTimeout, since },
            headers: this.authHeader(),
          });
          const sync = parseJson<MatrixSyncResponse>(res.data, "listenForMessages:sync");
          since = sync.next_batch;

          for (const [roomId, room] of Object.entries(sync.rooms?.join ?? {})) {
            if (roomIds && !roomIds.includes(roomId)) continue;

            const nameEvent = room.state.events.find((e) => e.type === "m.room.name");
            if (nameEvent?.content.name) roomNames.set(roomId, nameEvent.content.name as string);
            const freshMembers = this.buildNameMap(room.state.events);
            const memberMap = memberNames.get(roomId) ?? new Map<string, string>();
            for (const [uid, name] of freshMembers) memberMap.set(uid, name);
            memberNames.set(roomId, memberMap);

            const roomName = roomNames.get(roomId) ?? roomId;

            for (const event of room.timeline.events) {
              if (event.type !== "m.room.message") continue;
              if ((event.origin_server_ts ?? 0) < startedAt) continue;

              const sender = event.sender ?? "";
              const message: Message = {
                eventId: event.event_id ?? "",
                sender,
                senderName: memberNames.get(roomId)?.get(sender) ?? sender,
                body: (event.content.body as string) ?? "",
                msgtype: (event.content.msgtype as string) ?? "",
                timestamp: event.origin_server_ts ?? 0,
                encrypted: false,
              };

              try {
                await callback({ roomId, roomName, message }, () => {
                  stopped = true;
                });
              } catch (callbackErr) {
                const err =
                  callbackErr instanceof Error ? callbackErr : new Error(String(callbackErr));
                if (onError) onError(err);
                else log.error("listenForMessages callback failed");
              }
            }
          }
        } catch (error) {
          if (stopped) break;
          const err = error instanceof Error ? error : new Error(String(error));
          if (onError) onError(err);
          else log.error("listenForMessages sync failed");
        }
      }
    };

    queueMicrotask(() => {
      loop().catch((err) => {
        const e = err instanceof Error ? err : new Error(String(err));
        if (onError) onError(e);
        else log.error("listenForMessages failed");
      });
    });

    log.debug("Message listener started");
    return {
      stop: () => {
        stopped = true;
      },
    };
  }
}
