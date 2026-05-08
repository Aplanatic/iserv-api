import { describe, expect, test } from "vitest";
import { NotificationService } from "../src/Notifications/NotificationService.js";
import { createMockIServSession, iservJson, iservJsonError } from "./helpers/mockIServSession.js";

describe("NotificationService", () => {
  test("getAll returns parsed data with since=null", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/user/api/notifications",
          response: {
            data: iservJson({
              lastEventId: 1,
              lastId: 2,
              since: null,
              count: 1,
              notifications: [{ id: 2, title: "Neue Nachricht", message: "Test" }],
            }),
          },
        },
      ],
    });

    const result = await new NotificationService(session).getAll();

    expect(result.lastEventId).toBe(1);
    expect(result.since).toBeNull();
    expect(result.count).toBe(1);
    expect(result.notifications[0].title).toBe("Neue Nachricht");
    expectAllRoutesCalled();
  });

  test("getAll returns parsed data with since as IServDateTime object", async () => {
    const since = { date: "2026-05-08 18:14:10.358000", timezone_type: 2, timezone: "Z" };
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/user/api/notifications",
          response: {
            data: iservJson({
              lastEventId: 5158309,
              since,
              count: 0,
              notifications: [],
              read: [
                { id: 5158309, date: "2026-05-08T18:55:26+02:00", type: "calendar" },
                { id: 5158326, date: "2026-05-08T18:54:55+02:00", type: "mail" },
              ],
            }),
          },
        },
      ],
    });

    const result = await new NotificationService(session).getAll();

    expect(result.lastEventId).toBe(5158309);
    expect(result.since).toEqual(since);
    expect(result.since?.date).toBe("2026-05-08 18:14:10.358000");
    expect(result.since?.timezone).toBe("Z");
    expect(result.count).toBe(0);
    expect(result.notifications).toHaveLength(0);
    expect(result.read).toHaveLength(2);
    expect(result.read?.[0].type).toBe("calendar");
    expect(result.read?.[1].type).toBe("mail");
    expectAllRoutesCalled();
  });

  test("getBadges calls the navigation badges endpoint and returns the raw badge map", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/app/navigation/badges",
          response: { data: JSON.stringify({ messenger: 2, mail: 1 }) },
        },
      ],
    });

    await expect(new NotificationService(session).getBadges()).resolves.toEqual({
      messenger: 2,
      mail: 1,
    });
    expectAllRoutesCalled();
  });

  test("readAll and read call the write endpoints as POST and unwrap IServ JSON", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "post",
          url: "https://iserv.example/iserv/notification/api/v1/notifications/readall",
          response: { data: iservJson({ ok: true }) },
        },
        {
          method: "post",
          url: "https://iserv.example/iserv/notification/api/v1/notifications/42/read",
          response: { data: iservJson({ ok: true }) },
        },
      ],
    });
    const service = new NotificationService(session);

    await expect(service.readAll()).resolves.toEqual({ ok: true });
    await expect(service.read(42)).resolves.toEqual({ ok: true });
    expectAllRoutesCalled();
  });

  describe("read(id) validation", () => {
    test("throws when id=0", async () => {
      const { session } = createMockIServSession({ routes: [] });
      await expect(new NotificationService(session).read(0)).rejects.toThrow(
        "id must be a positive integer",
      );
    });

    test("throws when id=-1", async () => {
      const { session } = createMockIServSession({ routes: [] });
      await expect(new NotificationService(session).read(-1)).rejects.toThrow(
        "id must be a positive integer",
      );
    });

    test("throws when id is a float", async () => {
      const { session } = createMockIServSession({ routes: [] });
      await expect(new NotificationService(session).read(1.5)).rejects.toThrow(
        "id must be a positive integer",
      );
    });

    test("does NOT throw when id=1", async () => {
      const { session } = createMockIServSession({
        routes: [
          {
            method: "post",
            url: "https://iserv.example/iserv/notification/api/v1/notifications/1/read",
            response: { data: iservJson({ ok: true }) },
          },
        ],
      });
      await expect(new NotificationService(session).read(1)).resolves.toBeDefined();
    });
  });

  test("throws when an IServ JSON response reports an error", async () => {
    const { session } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/user/api/notifications",
          response: { data: iservJsonError("No access") },
        },
      ],
    });

    await expect(new NotificationService(session).getAll()).rejects.toThrow("No access");
  });
});
