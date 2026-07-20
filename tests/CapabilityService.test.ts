import { describe, expect, test } from "vitest";
import { CapabilityService } from "../src/Capabilities/CapabilityService.js";
import { createMockIServSession } from "./helpers/mockIServSession.js";

describe("CapabilityService", () => {
  test("builds a complete unknown snapshot when live detection is unavailable", () => {
    const capabilities = CapabilityService.unknown();

    expect(capabilities.length).toBeGreaterThan(20);
    expect(capabilities.every((item) => item.access === "unknown")).toBe(true);
    expect(
      capabilities.find((item) => item.module === "calendar")?.catalogued.read,
    ).toBeGreaterThan(0);
  });

  test("maps installed navigation modules to honest catalog capabilities", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/",
          response: {
            data: `
              <a href="/iserv/account/my">Account</a>
              <a href="/iserv/calendar">Calendar</a>
              <a href="/iserv/news">News</a>
              <a href="/iserv/dsa-pinboard">Pinboard</a>
            `,
          },
        },
      ],
    });

    const capabilities = await new CapabilityService(session).list();

    expect(capabilities.find((item) => item.module === "calendar")).toMatchObject({
      access: "available",
      catalogued: { read: expect.any(Number), communicative: 1 },
    });
    expect(capabilities.find((item) => item.module === "pinboard")?.access).toBe("experimental");
    expect(capabilities.find((item) => item.module === "office")?.access).toBe("not-installed");
    expectAllRoutesCalled();
  });
});
