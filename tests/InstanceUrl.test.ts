import { describe, expect, test } from "vitest";
import { assertSameOrigin, normalizeInstanceUrl } from "../src/Core/InstanceUrl.js";

describe("normalizeInstanceUrl", () => {
  test.each([
    ["iserv.example", "https://iserv.example"],
    ["https://iserv.example", "https://iserv.example"],
    ["https://ISERV.EXAMPLE/iserv/", "https://iserv.example"],
  ])("normalizes %s", (input, origin) => {
    expect(normalizeInstanceUrl(input)).toEqual({ origin, hostname: "iserv.example" });
  });

  test.each([
    "http://iserv.example",
    "https://user:pass@iserv.example",
    "https://iserv.example/other",
    "https://iserv.example?token=value",
    "https://iserv.example:8443",
    "localhost",
    "192.168.1.2",
  ])("rejects unsafe input %s", (input) => {
    expect(() => normalizeInstanceUrl(input)).toThrow();
  });

  test("allows an explicitly approved private host", () => {
    expect(normalizeInstanceUrl("localhost", { allowPrivateHost: true }).hostname).toBe("localhost");
  });

  test("rejects cross-origin redirects", () => {
    expect(() => assertSameOrigin("https://iserv.example", "https://example.invalid/iserv"))
      .toThrowError(/Cross-origin/);
  });
});
