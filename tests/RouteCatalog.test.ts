import { describe, expect, test } from "vitest";
import { ROUTES, RouteCatalog } from "../src/Routes/RouteCatalog.js";

describe("RouteCatalog", () => {
  test("contains unique, classified route definitions", () => {
    const ids = ROUTES.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const route of ROUTES) {
      expect(route.description.length).toBeGreaterThan(10);
      expect(route.parameters).toBeInstanceOf(Array);
      expect(route.provenance.reference).not.toBe("");
    }
  });

  test("searches and groups routes", () => {
    const catalog = new RouteCatalog();
    expect(catalog.search("webdav").map((route) => route.id)).toContain("files.webdav");
    expect(catalog.tree().calendar?.length).toBeGreaterThan(1);
    expect(catalog.get("messenger.send").sideEffect).toBe("communicative");
    expect(catalog.get("news.show")).toMatchObject({
      status: "supported",
      lastVerified: "2026-07-20",
      provenance: { kind: "live-contract" },
    });
    expect(catalog.get("pinboard.list").status).toBe("experimental");
  });

  test("classifies all newly discovered module routes as read-only", () => {
    const modules = [
      "exercise",
      "timetable",
      "poll",
      "forums",
      "news",
      "course-selection",
      "mailing-lists",
      "print",
      "pinboard",
    ];
    const discovered = ROUTES.filter((route) => modules.includes(route.module));
    expect(discovered.length).toBeGreaterThanOrEqual(12);
    expect(discovered.every((route) => route.method === "GET")).toBe(true);
    expect(discovered.every((route) => route.sideEffect === "read")).toBe(true);
  });

  test("rejects duplicate route IDs", () => {
    expect(() => new RouteCatalog([ROUTES[0]!, ROUTES[0]!])).toThrow(/Duplicate/);
  });
});
