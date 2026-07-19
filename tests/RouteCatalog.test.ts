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
  });

  test("rejects duplicate route IDs", () => {
    expect(() => new RouteCatalog([ROUTES[0]!, ROUTES[0]!])).toThrow(/Duplicate/);
  });
});
