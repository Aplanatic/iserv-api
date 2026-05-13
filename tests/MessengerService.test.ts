import { describe, expect, test } from "vitest";
import { IServApiError } from "../src/Core/Errors.js";
import { MessengerService } from "../src/Messenger/MessengerService.js";
import { createMockIServSession } from "./helpers/mockIServSession.js";

const MATRIX_BASE = "https://iserv.example/_matrix/client/v3";
const MATRIX_TOKEN = "syt_test_token_abc";

function buildMockSession(routes: Parameters<typeof createMockIServSession>[0]["routes"]) {
  const { session, ...rest } = createMockIServSession({ routes });
  session.setMatrixToken(MATRIX_TOKEN);
  return { session, ...rest };
}

const SYNC_FILTER = JSON.stringify({
  room: { timeline: { limit: 1 } },
});

describe("MessengerService.getRooms()", () => {
  test("returns parsed rooms from sync response", async () => {
    const syncResponse = JSON.stringify({
      next_batch: "s123",
      rooms: {
        join: {
          "!room1:server": {
            timeline: {
              events: [
                {
                  type: "m.room.message",
                  sender: "@alice:server",
                  event_id: "$ev1",
                  origin_server_ts: 1700000000000,
                  content: { msgtype: "m.text", body: "Hello!" },
                },
              ],
            },
            state: {
              events: [
                { type: "m.room.name", content: { name: "Test Room" } },
                {
                  type: "m.room.member",
                  state_key: "@alice:server",
                  content: { membership: "join", displayname: "Alice" },
                },
              ],
            },
            unread_notifications: { notification_count: 3 },
          },
        },
      },
      account_data: { events: [] },
    });

    const { session, expectAllRoutesCalled } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/sync`,
        params: { filter: SYNC_FILTER, timeout: 0 },
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: syncResponse },
      },
    ]);

    const rooms = await new MessengerService(session).getRooms();

    expect(rooms).toHaveLength(1);
    expect(rooms[0].id).toBe("!room1:server");
    expect(rooms[0].name).toBe("Test Room");
    expect(rooms[0].unreadCount).toBe(3);
    expect(rooms[0].isDirect).toBe(false);
    expect(rooms[0].lastMessage?.body).toBe("Hello!");
    expect(rooms[0].lastMessage?.sender).toBe("@alice:server");
    expect(rooms[0].lastMessage?.senderName).toBe("Alice");
    expect(rooms[0].lastMessage?.timestamp).toBe(1700000000000);
    expectAllRoutesCalled();
  });

  test("marks room as direct when roomId is in m.direct account_data", async () => {
    const syncResponse = JSON.stringify({
      next_batch: "s124",
      rooms: {
        join: {
          "!dm:server": {
            timeline: { events: [] },
            state: { events: [] },
            unread_notifications: {},
          },
        },
      },
      account_data: {
        events: [{ type: "m.direct", content: { "@bob:server": ["!dm:server"] } }],
      },
    });

    const { session, expectAllRoutesCalled } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/sync`,
        params: { filter: SYNC_FILTER, timeout: 0 },
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: syncResponse },
      },
    ]);

    const rooms = await new MessengerService(session).getRooms();
    expect(rooms[0].isDirect).toBe(true);
    expectAllRoutesCalled();
  });

  test("returns null lastMessage when no message events in timeline", async () => {
    const syncResponse = JSON.stringify({
      next_batch: "s125",
      rooms: {
        join: {
          "!empty:server": {
            timeline: { events: [{ type: "m.room.member", content: {}, sender: "@x:s" }] },
            state: { events: [] },
            unread_notifications: {},
          },
        },
      },
      account_data: { events: [] },
    });

    const { session, expectAllRoutesCalled } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/sync`,
        params: { filter: SYNC_FILTER, timeout: 0 },
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: syncResponse },
      },
    ]);

    const rooms = await new MessengerService(session).getRooms();
    expect(rooms[0].lastMessage).toBeNull();
    expectAllRoutesCalled();
  });

  test("uses roomId as name when no m.room.name state event exists", async () => {
    const syncResponse = JSON.stringify({
      next_batch: "s126",
      rooms: {
        join: {
          "!noname:server": {
            timeline: { events: [] },
            state: { events: [] },
            unread_notifications: {},
          },
        },
      },
      account_data: { events: [] },
    });

    const { session } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/sync`,
        params: { filter: SYNC_FILTER, timeout: 0 },
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: syncResponse },
      },
    ]);

    const rooms = await new MessengerService(session).getRooms();
    expect(rooms[0].name).toBe("!noname:server");
  });
});

describe("MessengerService.getMessages()", () => {
  const ROOM_ID = "!testroom:server";
  const ENCODED_ROOM = encodeURIComponent(ROOM_ID);
  const MESSAGES_FILTER = JSON.stringify({ lazy_load_members: true });

  test("returns parsed messages and pagination tokens", async () => {
    const response = JSON.stringify({
      start: "t1",
      end: "t2",
      state: [
        {
          type: "m.room.member",
          state_key: "@alice:server",
          content: { membership: "join", displayname: "Alice" },
        },
      ],
      chunk: [
        {
          type: "m.room.message",
          event_id: "$ev1",
          sender: "@alice:server",
          origin_server_ts: 1700000001000,
          content: { msgtype: "m.text", body: "Hi there" },
        },
        {
          type: "m.room.encrypted",
          event_id: "$ev2",
          sender: "@bob:server",
          origin_server_ts: 1700000002000,
          content: { algorithm: "m.megolm.v1.aes-sha2" },
        },
      ],
    });

    const { session, expectAllRoutesCalled } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/messages`,
        params: { limit: 30, dir: "b", filter: MESSAGES_FILTER },
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: response },
      },
    ]);

    const result = await new MessengerService(session).getMessages(ROOM_ID);

    expect(result.start).toBe("t1");
    expect(result.end).toBe("t2");
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].eventId).toBe("$ev1");
    expect(result.messages[0].body).toBe("Hi there");
    expect(result.messages[0].msgtype).toBe("m.text");
    expect(result.messages[0].encrypted).toBe(false);
    expect(result.messages[0].senderName).toBe("Alice");
    expect(result.messages[1].encrypted).toBe(true);
    expect(result.messages[1].body).toBe("");
    expect(result.messages[1].senderName).toBeNull();
    expectAllRoutesCalled();
  });

  test("passes custom limit and from token", async () => {
    const response = JSON.stringify({ start: "t5", end: "t6", chunk: [] });

    const { session, expectAllRoutesCalled } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/messages`,
        params: { limit: 10, dir: "b", filter: MESSAGES_FILTER, from: "t5" },
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: response },
      },
    ]);

    const result = await new MessengerService(session).getMessages(ROOM_ID, {
      limit: 10,
      from: "t5",
    });

    expect(result.messages).toHaveLength(0);
    expectAllRoutesCalled();
  });
});

describe("MessengerService.getMembers()", () => {
  const ROOM_ID = "!testroom:server";
  const ENCODED_ROOM = encodeURIComponent(ROOM_ID);

  test("returns parsed members excluding left users", async () => {
    const response = JSON.stringify({
      chunk: [
        {
          type: "m.room.member",
          state_key: "@alice:server",
          content: { membership: "join", displayname: "Alice", avatar_url: "mxc://server/abc" },
        },
        {
          type: "m.room.member",
          state_key: "@bob:server",
          content: { membership: "invite", displayname: "Bob", avatar_url: null },
        },
      ],
    });

    const { session, expectAllRoutesCalled } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/members`,
        params: { not_membership: "leave" },
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: response },
      },
    ]);

    const members = await new MessengerService(session).getMembers(ROOM_ID);

    expect(members).toHaveLength(2);
    expect(members[0].userId).toBe("@alice:server");
    expect(members[0].displayName).toBe("Alice");
    expect(members[0].avatarUrl).toBe("mxc://server/abc");
    expect(members[0].membership).toBe("join");
    expect(members[1].userId).toBe("@bob:server");
    expect(members[1].membership).toBe("invite");
    expect(members[1].avatarUrl).toBeNull();
    expectAllRoutesCalled();
  });
});

describe("MessengerService.getProfile()", () => {
  test("returns parsed user profile", async () => {
    const userId = "@alice:server";
    const encodedUserId = encodeURIComponent(userId);
    const response = JSON.stringify({ displayname: "Alice Smith", avatar_url: "mxc://server/xyz" });

    const { session, expectAllRoutesCalled } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/profile/${encodedUserId}`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: response },
      },
    ]);

    const profile = await new MessengerService(session).getProfile(userId);

    expect(profile.userId).toBe(userId);
    expect(profile.displayName).toBe("Alice Smith");
    expect(profile.avatarUrl).toBe("mxc://server/xyz");
    expectAllRoutesCalled();
  });

  test("returns nulls for missing optional profile fields", async () => {
    const userId = "@anon:server";
    const encodedUserId = encodeURIComponent(userId);

    const { session } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/profile/${encodedUserId}`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: JSON.stringify({}) },
      },
    ]);

    const profile = await new MessengerService(session).getProfile(userId);

    expect(profile.displayName).toBeNull();
    expect(profile.avatarUrl).toBeNull();
  });
});

describe("MessengerService.sendMessage()", () => {
  const ROOM_ID = "!testroom:server";
  const ENCODED_ROOM = encodeURIComponent(ROOM_ID);

  test("posts to the correct Matrix endpoint and returns the event ID", async () => {
    const { session, calls, expectAllRoutesCalled } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/send/m.room.message/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { data: JSON.stringify({ event_id: "$abc123:server" }) },
      },
    ]);

    const result = await new MessengerService(session).sendMessage(ROOM_ID, "Hello!", "test-txn");

    expect(result.eventId).toBe("$abc123:server");
    expect(calls[0]?.body).toBe(JSON.stringify({ msgtype: "m.text", body: "Hello!" }));
    expectAllRoutesCalled();
  });

  test("encodes custom transaction IDs as URL path segments", async () => {
    const txnId = "test/txn?with#chars";
    const { session, expectAllRoutesCalled } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/send/m.room.message/${encodeURIComponent(txnId)}`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { data: JSON.stringify({ event_id: "$abc123:server" }) },
      },
    ]);

    await new MessengerService(session).sendMessage(ROOM_ID, "Hello!", txnId);

    expectAllRoutesCalled();
  });
});

describe("MessengerService.leaveRoom()", () => {
  const ROOM_ID = "!testroom:server";
  const ENCODED_ROOM = encodeURIComponent(ROOM_ID);

  test("posts an empty JSON body to the Matrix leave endpoint", async () => {
    const { session, calls, expectAllRoutesCalled } = buildMockSession([
      {
        method: "post",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/leave`,
        headers: {
          Authorization: `Bearer ${MATRIX_TOKEN}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: "https://iserv.example",
        },
        response: { data: JSON.stringify({}) },
      },
    ]);

    await new MessengerService(session).leaveRoom(ROOM_ID);

    expect(calls[0]?.body).toBe("{}");
    expectAllRoutesCalled();
  });

  test("encodes room IDs in the leave URL", async () => {
    const roomId = "!room/with?chars:server";
    const { session, expectAllRoutesCalled } = buildMockSession([
      {
        method: "post",
        url: `${MATRIX_BASE}/rooms/${encodeURIComponent(roomId)}/leave`,
        headers: {
          Authorization: `Bearer ${MATRIX_TOKEN}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: "https://iserv.example",
        },
        response: { data: JSON.stringify({}) },
      },
    ]);

    await new MessengerService(session).leaveRoom(roomId);
    expectAllRoutesCalled();
  });

  test("throws when Matrix token is missing", async () => {
    const { session } = createMockIServSession({ routes: [] });

    await expect(new MessengerService(session).leaveRoom(ROOM_ID)).rejects.toThrow(
      "Matrix token is missing",
    );
  });
});

describe("MessengerService.sendMessageByName()", () => {
  const ROOM_ID = "!testroom:server";
  const ENCODED_ROOM = encodeURIComponent(ROOM_ID);
  const SYNC_FILTER = JSON.stringify({ room: { timeline: { limit: 1 } } });

  const SYNC_RESPONSE = JSON.stringify({
    next_batch: "s1",
    rooms: {
      join: {
        [ROOM_ID]: {
          timeline: { events: [] },
          state: { events: [{ type: "m.room.name", content: { name: "Test Room" } }] },
          unread_notifications: { notification_count: 0 },
        },
      },
    },
    account_data: { events: [] },
  });

  test("looks up the room by name and sends the message", async () => {
    const { session, calls, expectAllRoutesCalled } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/sync`,
        params: { filter: SYNC_FILTER, timeout: 0 },
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: SYNC_RESPONSE },
      },
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/send/m.room.message/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { data: JSON.stringify({ event_id: "$abc123:server" }) },
      },
    ]);

    const result = await new MessengerService(session).sendMessageByName(
      "Test Room",
      "Hello!",
      "test-txn",
    );

    expect(result.eventId).toBe("$abc123:server");
    expect(calls[1]?.body).toBe(JSON.stringify({ msgtype: "m.text", body: "Hello!" }));
    expectAllRoutesCalled();
  });

  test("throws when no room matches the name", async () => {
    const { session } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/sync`,
        params: { filter: SYNC_FILTER, timeout: 0 },
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: SYNC_RESPONSE },
      },
    ]);

    await expect(new MessengerService(session).sendMessageByName("Nobody", "Hi")).rejects.toThrow(
      `No room found with name "Nobody"`,
    );
  });

  test("throws when multiple rooms match the name", async () => {
    const DUPLICATE_SYNC = JSON.stringify({
      next_batch: "s1",
      rooms: {
        join: {
          "!room1:server": {
            timeline: { events: [] },
            state: { events: [{ type: "m.room.name", content: { name: "Same Name" } }] },
            unread_notifications: {},
          },
          "!room2:server": {
            timeline: { events: [] },
            state: { events: [{ type: "m.room.name", content: { name: "Same Name" } }] },
            unread_notifications: {},
          },
        },
      },
      account_data: { events: [] },
    });

    const { session } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/sync`,
        params: { filter: SYNC_FILTER, timeout: 0 },
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: DUPLICATE_SYNC },
      },
    ]);

    await expect(
      new MessengerService(session).sendMessageByName("Same Name", "Hi"),
    ).rejects.toThrow(`Multiple rooms found with name "Same Name"`);
  });
});

describe("MessengerService.reactToMessage()", () => {
  const ROOM_ID = "!testroom:server";
  const ENCODED_ROOM = encodeURIComponent(ROOM_ID);
  const EVENT_ID = "$lMGK1fUJfrFLrKgxEy711dqAr";

  test("sends a reaction to a message", async () => {
    const { session, calls, expectAllRoutesCalled } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/send/m.reaction/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { data: JSON.stringify({ event_id: "$reaction123:server" }) },
      },
    ]);

    const result = await new MessengerService(session).reactToMessage(
      ROOM_ID,
      EVENT_ID,
      "👍",
      "test-txn",
    );

    expect(result.eventId).toBe("$reaction123:server");
    expect(calls[0]?.body).toBe(
      JSON.stringify({
        "m.relates_to": { rel_type: "m.annotation", event_id: EVENT_ID, key: "👍" },
      }),
    );
    expectAllRoutesCalled();
  });
});

describe("MessengerService.createDirectMessage()", () => {
  const FORM_URL = "https://iserv.example/iserv/messenger/form/directmessage/create";
  const FORM_ACTION_URL = "https://iserv.example/iserv/messenger/form/directmessage/create?modal=1";
  const MATRIX_ID = "userid:3a1a62a5-fedf-4ad0-aa72-80160fe7d13a";
  const CSRF_TOKEN = "csrf-test-token-123";
  const FORM_HTML = `
    <form action="/iserv/messenger/form/directmessage/create?modal=1">
      <input type="hidden" name="directmessage[_token]" value="${CSRF_TOKEN}" />
    </form>
  `;
  const AJAX_HEADERS = {
    Accept: "text/html, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
  };
  const POST_HEADERS = {
    ...AJAX_HEADERS,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Origin: "https://iserv.example",
  };

  test("fetches the direct-message form token via XHR then POSTs HAR-compatible form data", async () => {
    const { session, calls, expectAllRoutesCalled } = buildMockSession([
      {
        method: "get",
        url: FORM_URL,
        headers: AJAX_HEADERS,
        response: { data: FORM_HTML },
      },
      {
        method: "post",
        url: FORM_ACTION_URL,
        headers: POST_HEADERS,
        response: { data: JSON.stringify({ room_id: "!newroom:server" }) },
      },
    ]);

    const result = await new MessengerService(session).createDirectMessage(MATRIX_ID);

    expect(result.roomId).toBe("!newroom:server");
    const postBody = new URLSearchParams(calls[1]?.body ?? "");
    expect(postBody.get("directmessage[matrix_id]")).toBe(MATRIX_ID);
    expect(postBody.get("directmessage[_token]")).toBe(CSRF_TOKEN);
    expect(postBody.get("directmessage[submit]")).toBe("");
    expect(calls[1]?.body).toBe(
      "directmessage%5Bmatrix_id%5D=userid%3A3a1a62a5-fedf-4ad0-aa72-80160fe7d13a&directmessage%5B_token%5D=csrf-test-token-123&directmessage%5Bsubmit%5D=",
    );
    expectAllRoutesCalled();
  });

  test("falls back to the legacy directmessage__token id when no named token exists", async () => {
    const { session, calls, expectAllRoutesCalled } = buildMockSession([
      {
        method: "get",
        url: FORM_URL,
        headers: AJAX_HEADERS,
        response: {
          data: `<html><body><input id="directmessage__token" value="${CSRF_TOKEN}" /></body></html>`,
        },
      },
      {
        method: "post",
        url: FORM_URL,
        headers: POST_HEADERS,
        response: { data: JSON.stringify({ room_id: "!legacytoken:server" }) },
      },
    ]);

    const result = await new MessengerService(session).createDirectMessage(MATRIX_ID);

    expect(result.roomId).toBe("!legacytoken:server");
    const postBody = new URLSearchParams(calls[1]?.body ?? "");
    expect(postBody.get("directmessage[_token]")).toBe(CSRF_TOKEN);
    expectAllRoutesCalled();
  });

  test("throws when CSRF token is missing from form HTML", async () => {
    const { session } = buildMockSession([
      {
        method: "get",
        url: FORM_URL,
        headers: AJAX_HEADERS,
        response: { data: "<html><body>no token here</body></html>" },
      },
    ]);

    await expect(new MessengerService(session).createDirectMessage(MATRIX_ID)).rejects.toThrow(
      "CSRF token",
    );
  });

  test("throws when the response does not include room_id", async () => {
    const { session } = buildMockSession([
      {
        method: "get",
        url: FORM_URL,
        headers: AJAX_HEADERS,
        response: { data: FORM_HTML },
      },
      {
        method: "post",
        url: FORM_ACTION_URL,
        headers: POST_HEADERS,
        response: { data: JSON.stringify({}) },
      },
    ]);

    await expect(new MessengerService(session).createDirectMessage(MATRIX_ID)).rejects.toThrow(
      "room_id",
    );
  });
});

describe("MessengerService.editMessage()", () => {
  const ROOM_ID = "!testroom:server";
  const ENCODED_ROOM = encodeURIComponent(ROOM_ID);
  const EVENT_ID = "$original123:server";

  test("sends an edit with correct Matrix replace format", async () => {
    const { session, calls, expectAllRoutesCalled } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/send/m.room.message/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { data: JSON.stringify({ event_id: "$edit456:server" }) },
      },
    ]);

    const result = await new MessengerService(session).editMessage(
      ROOM_ID,
      EVENT_ID,
      "edited text",
      "test-txn",
    );

    expect(result.eventId).toBe("$edit456:server");

    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body.msgtype).toBe("m.text");
    expect(body.body).toBe(" * edited text");
    expect(body["m.relates_to"]).toEqual({ rel_type: "m.replace", event_id: EVENT_ID });
    expect(body["m.new_content"]).toEqual({ msgtype: "m.text", body: "edited text" });
    expectAllRoutesCalled();
  });

  test("encodes roomId and txnId in the URL", async () => {
    const txnId = "txn/with?chars";
    const { session, expectAllRoutesCalled } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/send/m.room.message/${encodeURIComponent(txnId)}`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { data: JSON.stringify({ event_id: "$edit789:server" }) },
      },
    ]);

    await new MessengerService(session).editMessage(ROOM_ID, EVENT_ID, "new text", txnId);
    expectAllRoutesCalled();
  });
});

describe("MessengerService.replyToMessage()", () => {
  const ROOM_ID = "!testroom:server";
  const ENCODED_ROOM = encodeURIComponent(ROOM_ID);
  const ORIGINAL = {
    eventId: "$original123:server",
    sender: "@alice:server",
    body: "Original message",
  };

  test("sends a reply with correct Matrix reply format", async () => {
    const { session, calls, expectAllRoutesCalled } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/send/m.room.message/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { data: JSON.stringify({ event_id: "$reply456:server" }) },
      },
    ]);

    const result = await new MessengerService(session).replyToMessage(
      ROOM_ID,
      ORIGINAL,
      "My reply",
      "test-txn",
    );

    expect(result.eventId).toBe("$reply456:server");

    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body.msgtype).toBe("m.text");
    expect(body["m.relates_to"]).toEqual({ "m.in_reply_to": { event_id: ORIGINAL.eventId } });
    expect(body.body).toContain(ORIGINAL.body);
    expect(body.body).toContain("My reply");
    expect(body.formatted_body).toContain(ORIGINAL.eventId);
    expect(body.formatted_body).toContain(ORIGINAL.sender);
    expect(body.formatted_body).toContain("My reply");
    expectAllRoutesCalled();
  });

  test("escapes HTML in the formatted reply body", async () => {
    const { session, calls, expectAllRoutesCalled } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/send/m.room.message/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { data: JSON.stringify({ event_id: "$reply456:server" }) },
      },
    ]);

    await new MessengerService(session).replyToMessage(
      ROOM_ID,
      {
        eventId: "$orig<script>:server",
        sender: '@alice:server" onclick="bad',
        body: '<img src=x onerror="bad()">',
      },
      'Thanks <b onclick="bad()">Alice</b>',
      "test-txn",
    );

    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body.body).toContain('<img src=x onerror="bad()">');
    expect(body.formatted_body).not.toContain("<img");
    expect(body.formatted_body).not.toContain("<b onclick");
    expect(body.formatted_body).toContain("&lt;img src=x onerror=&quot;bad()&quot;&gt;");
    expect(body.formatted_body).toContain("Thanks &lt;b onclick=&quot;bad()&quot;&gt;Alice&lt;/b&gt;");
    expectAllRoutesCalled();
  });

  test("encodes the txnId in the URL", async () => {
    const txnId = "txn/with?chars";
    const { session, expectAllRoutesCalled } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/send/m.room.message/${encodeURIComponent(txnId)}`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { data: JSON.stringify({ event_id: "$reply789:server" }) },
      },
    ]);

    await new MessengerService(session).replyToMessage(ROOM_ID, ORIGINAL, "Reply", txnId);
    expectAllRoutesCalled();
  });
});

describe("MessengerService.removeReaction()", () => {
  const ROOM_ID = "!testroom:server";
  const ENCODED_ROOM = encodeURIComponent(ROOM_ID);
  const REACTION_EVENT_ID = "$reaction123:server";
  const ENCODED_REACTION_EVENT = encodeURIComponent(REACTION_EVENT_ID);

  test("calls the redact endpoint and returns the event ID", async () => {
    const { session, calls, expectAllRoutesCalled } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/redact/${ENCODED_REACTION_EVENT}/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { data: JSON.stringify({ event_id: "$redact456:server" }) },
      },
    ]);

    const result = await new MessengerService(session).removeReaction(
      ROOM_ID,
      REACTION_EVENT_ID,
      "test-txn",
    );

    expect(result.eventId).toBe("$redact456:server");
    expect(calls[0]?.body).toBe("{}");
    expectAllRoutesCalled();
  });

  test("throws a descriptive error when the reaction event is not found (404)", async () => {
    const notFound = new IServApiError("HTTP 404", 404);

    const { session } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/redact/${ENCODED_REACTION_EVENT}/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { error: notFound },
      },
    ]);

    await expect(
      new MessengerService(session).removeReaction(ROOM_ID, REACTION_EVENT_ID, "test-txn"),
    ).rejects.toThrow(`Reaction "${REACTION_EVENT_ID}" not found`);
  });

  test("throws a descriptive error when not authorized to remove the reaction (403)", async () => {
    const forbidden = new IServApiError("HTTP 403", 403);

    const { session } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/redact/${ENCODED_REACTION_EVENT}/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { error: forbidden },
      },
    ]);

    await expect(
      new MessengerService(session).removeReaction(ROOM_ID, REACTION_EVENT_ID, "test-txn"),
    ).rejects.toThrow(`Not authorized to remove reaction "${REACTION_EVENT_ID}"`);
  });

  test("rethrows unknown errors unchanged", async () => {
    const unexpected = new Error("Network failure");

    const { session } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/redact/${ENCODED_REACTION_EVENT}/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { error: unexpected },
      },
    ]);

    await expect(
      new MessengerService(session).removeReaction(ROOM_ID, REACTION_EVENT_ID, "test-txn"),
    ).rejects.toThrow("Network failure");
  });
});

describe("MessengerService.deleteMessage()", () => {
  const ROOM_ID = "!testroom:server";
  const ENCODED_ROOM = encodeURIComponent(ROOM_ID);
  const MESSAGE_EVENT_ID = "$msg123:server";
  const ENCODED_MESSAGE_EVENT = encodeURIComponent(MESSAGE_EVENT_ID);

  test("calls the redact endpoint and returns the event ID", async () => {
    const { session, calls, expectAllRoutesCalled } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/redact/${ENCODED_MESSAGE_EVENT}/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { data: JSON.stringify({ event_id: "$redact789:server" }) },
      },
    ]);

    const result = await new MessengerService(session).deleteMessage(
      ROOM_ID,
      MESSAGE_EVENT_ID,
      "test-txn",
    );

    expect(result.eventId).toBe("$redact789:server");
    expect(calls[0]?.body).toBe("{}");
    expectAllRoutesCalled();
  });

  test("throws a descriptive error when the message event is not found (404)", async () => {
    const notFound = new IServApiError("HTTP 404", 404);

    const { session } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/redact/${ENCODED_MESSAGE_EVENT}/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { error: notFound },
      },
    ]);

    await expect(
      new MessengerService(session).deleteMessage(ROOM_ID, MESSAGE_EVENT_ID, "test-txn"),
    ).rejects.toThrow(`Message "${MESSAGE_EVENT_ID}" not found`);
  });

  test("throws a descriptive error when not authorized (403)", async () => {
    const forbidden = new IServApiError("HTTP 403", 403);

    const { session } = buildMockSession([
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/redact/${ENCODED_MESSAGE_EVENT}/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { error: forbidden },
      },
    ]);

    await expect(
      new MessengerService(session).deleteMessage(ROOM_ID, MESSAGE_EVENT_ID, "test-txn"),
    ).rejects.toThrow(`Not authorized to delete message "${MESSAGE_EVENT_ID}"`);
  });
});

describe("MessengerService.reactToMessageByName()", () => {
  const ROOM_ID = "!testroom:server";
  const ENCODED_ROOM = encodeURIComponent(ROOM_ID);
  const EVENT_ID = "$someEvent";
  const SYNC_FILTER = JSON.stringify({ room: { timeline: { limit: 1 } } });

  const SYNC_RESPONSE = JSON.stringify({
    next_batch: "s1",
    rooms: {
      join: {
        [ROOM_ID]: {
          timeline: { events: [] },
          state: { events: [{ type: "m.room.name", content: { name: "Test Room" } }] },
          unread_notifications: { notification_count: 0 },
        },
      },
    },
    account_data: { events: [] },
  });

  test("looks up the room by name and reacts to a message", async () => {
    const { session, calls, expectAllRoutesCalled } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/sync`,
        params: { filter: SYNC_FILTER, timeout: 0 },
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: SYNC_RESPONSE },
      },
      {
        method: "put",
        url: `${MATRIX_BASE}/rooms/${ENCODED_ROOM}/send/m.reaction/test-txn`,
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}`, "Content-Type": "application/json" },
        response: { data: JSON.stringify({ event_id: "$reaction456:server" }) },
      },
    ]);

    const result = await new MessengerService(session).reactToMessageByName(
      "Test Room",
      EVENT_ID,
      "❤️",
      "test-txn",
    );

    expect(result.eventId).toBe("$reaction456:server");
    expect(calls[1]?.body).toBe(
      JSON.stringify({
        "m.relates_to": { rel_type: "m.annotation", event_id: EVENT_ID, key: "❤️" },
      }),
    );
    expectAllRoutesCalled();
  });

  test("throws when no room matches the name", async () => {
    const { session } = buildMockSession([
      {
        method: "get",
        url: `${MATRIX_BASE}/sync`,
        params: { filter: SYNC_FILTER, timeout: 0 },
        headers: { Authorization: `Bearer ${MATRIX_TOKEN}` },
        response: { data: SYNC_RESPONSE },
      },
    ]);

    await expect(
      new MessengerService(session).reactToMessageByName("Nobody", EVENT_ID, "👍"),
    ).rejects.toThrow(`No room found with name "Nobody"`);
  });
});
