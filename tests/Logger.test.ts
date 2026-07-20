import { afterEach, describe, expect, test, vi } from "vitest";
import { createLogger } from "../src/Core/Logger.js";

describe("createLogger", () => {
  afterEach(() => vi.restoreAllMocks());

  test("redacts hostnames and email addresses from emitted warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    createLogger("Test").warn("Contact alice@example.test through school.example.net");

    expect(warn).toHaveBeenCalledWith(
      "[IServ:Test] Contact [redacted-email] through [redacted-host]",
    );
  });
});
