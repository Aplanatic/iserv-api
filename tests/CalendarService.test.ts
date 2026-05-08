import { describe, expect, test } from "vitest";
import { CalendarService } from "../src/Calendar/CalendarService.js";
import { createMockIServSession } from "./helpers/mockIServSession.js";

describe("CalendarService read APIs", () => {
  test("getUpcomingEvents calls the IServ upcoming endpoint and parses its raw JSON", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/calendar/api/upcoming",
          response: {
            data: JSON.stringify({
              events: [{ title: "Termin", start: "2026-05-08T08:00:00+02:00" }],
              errors: [],
            }),
          },
        },
      ],
    });

    await expect(new CalendarService(session).getUpcomingEvents()).resolves.toEqual({
      events: [{ title: "Termin", start: "2026-05-08T08:00:00+02:00" }],
      errors: [],
    });
    expectAllRoutesCalled();
  });

  test("getEventSources calls the event source endpoint and keeps IServ source fields", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/calendar/api/eventsources",
          response: {
            data: JSON.stringify([
              {
                label: "Example User",
                id: "/example.user/home",
                subscription: false,
                color: "#3366CC",
                textColor: "#FFFFFF",
                url: "/iserv/calendar/feed/calendar?cal=/example.user/home",
                type: "cal",
                droppable: true,
              },
            ]),
          },
        },
      ],
    });

    const sources = await new CalendarService(session).getEventSources();

    expect(sources[0]).toMatchObject({
      id: "/example.user/home",
      url: "/iserv/calendar/feed/calendar?cal=/example.user/home",
      droppable: true,
    });
    expectAllRoutesCalled();
  });

  test("getEvents sends the normalized date range as query parameters", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/calendar/feed/calendar-multi",
          params: { start: "2026-05-01", end: "2026-05-31" },
          response: {
            data: JSON.stringify({
              "/example.user/home": [{ title: "Termin", uid: "42" }],
            }),
          },
        },
      ],
    });

    await expect(
      new CalendarService(session).getEvents("2026-05-01", "2026-05-31"),
    ).resolves.toEqual({
      "/example.user/home": [{ title: "Termin", uid: "42" }],
    });
    expectAllRoutesCalled();
  });

  test("searchEvents mirrors IServ lookup_event parameters", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/calendar/api/lookup_event",
          params: {
            summary: "Termin",
            start: "2026-05-01T00:00:00.000Z",
            end: "2026-05-31T00:00:00.000Z",
          },
          response: { data: JSON.stringify([{ title: "Termin", uid: "42" }]) },
        },
      ],
    });

    await expect(
      new CalendarService(session).searchEvents("Termin", "2026-05-01", "2026-05-31"),
    ).resolves.toEqual([{ title: "Termin", uid: "42" }]);
    expectAllRoutesCalled();
  });

  test("getPluginEvents rejects invalid plugin names before hitting IServ", async () => {
    const { session, calls } = createMockIServSession({ routes: [] });

    await expect(
      new CalendarService(session).getPluginEvents("../bad", "2026-05-01", "2026-05-31"),
    ).rejects.toThrow("Invalid plugin name");
    expect(calls).toHaveLength(0);
  });
});

describe("CalendarService write APIs", () => {
  test("deleteEvent accepts IServ calendar path ids and returns the JSON status response", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "post",
          url: "https://iserv.example/iserv/calendar/delete",
          body: null,
          params: {
            uid: "20260508-132217-example@iserv.example",
            hash: "f3f094984163c181741e03c60e2d3db6",
            cal: "/example.user/home",
            start: "2026-05-08T15:22:00+02:00",
            edit_series: "single",
          },
          response: {
            data: JSON.stringify({
              status: "success",
              subject: "API Test Event",
              calendar: "/example.user/home",
              lastPageHash: "",
            }),
          },
        },
      ],
    });

    const result = await new CalendarService(session).deleteEvent({
      uid: "20260508-132217-example@iserv.example",
      hash: "f3f094984163c181741e03c60e2d3db6",
      calendar: "/example.user/home",
      start: "2026-05-08T15:22:00+02:00",
    });

    expect(JSON.parse(result)).toEqual({
      status: "success",
      subject: "API Test Event",
      calendar: "/example.user/home",
      lastPageHash: "",
    });
    expectAllRoutesCalled();
  });

  test("createEvent returns JSON event metadata instead of IServ's HTML page", async () => {
    const formData = new URLSearchParams();
    for (const [key, value] of [
      ["eventForm[uid]", ""],
      ["eventForm[etag]", ""],
      ["eventForm[hash]", ""],
      ["eventForm[calendarOrg]", ""],
      ["eventForm[startOrg]", ""],
      ["eventForm[action]", "create"],
      ["eventForm[seriesAction]", ""],
      ["eventForm[invited]", ""],
      ["eventForm[subscription]", ""],
      ["eventForm[subject]", "API Test Event"],
      ["eventForm[calendar]", "/example.user/home"],
      ["eventForm[category]", ""],
      ["eventForm[location]", ""],
      ["eventForm[startDate]", "08.05.2026"],
      ["eventForm[startTime]", "15:22"],
      ["eventForm[endDate]", "08.05.2026"],
      ["eventForm[endTime]", "16:22"],
      ["eventForm[description]", "created via iserv-api"],
      ["eventForm[showMeAs]", "OPAQUE"],
      ["eventForm[privacy]", "PUBLIC"],
      ["eventForm[recurring][intervalType]", "NO"],
      ["eventForm[recurring][interval]", "1"],
      ["eventForm[recurring][monthlyIntervalType]", "BYMONTHDAY"],
      ["eventForm[recurring][monthDayInMonth]", ""],
      ["eventForm[recurring][endType]", "NEVER"],
      ["eventForm[submit]", ""],
      ["eventForm[_token]", "csrf-token"],
    ]) {
      formData.append(key, value);
    }

    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/calendar/create_simple",
          headers: { "X-Requested-With": "XMLHttpRequest", Accept: "*/*" },
          response: { data: '<input id="eventForm__token" value="csrf-token">' },
        },
        {
          method: "post",
          url: "https://iserv.example/iserv/calendar/create",
          body: formData.toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          params: {
            subject: "API Test Event",
            calendar: "/example.user/home",
            start: "08.05.2026",
            end: "08.05.2026",
            startTime: "15:22",
            endTime: "16:22",
            allDay: false,
          },
          response: { data: "<!doctype html><html><body>created</body></html>" },
        },
      ],
    });

    const result = await new CalendarService(session).createEvent({
      subject: "API Test Event",
      calendar: "/example.user/home",
      start: "2026-05-08T15:22:00+02:00",
      end: "2026-05-08T16:22:00+02:00",
      description: "created via iserv-api",
    });

    expect(JSON.parse(result)).toEqual({
      status: "success",
      subject: "API Test Event",
      calendar: "/example.user/home",
      start: "2026-05-08T13:22:00.000Z",
      end: "2026-05-08T14:22:00.000Z",
    });
    expectAllRoutesCalled();
  });
});
