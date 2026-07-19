import { describe, expect, test } from "vitest";
import { redactText, redactValue } from "../src/Core/Redaction.js";

describe("redaction", () => {
  test("redacts personal hosts and email addresses", () => {
    expect(redactText("person@example.com on school.example.org")).toBe(
      "[redacted-email] on [redacted-host]",
    );
  });

  test("redacts secret-shaped object fields and bounds arrays", () => {
    const result = redactValue({ password: "test-password", nested: { token: "abc" }, items: Array.from({ length: 110 }, (_, index) => index) });
    expect(result).toMatchObject({ password: "[redacted]", nested: { token: "[redacted]" } });
    expect((result as { items: unknown[] }).items).toHaveLength(100);
  });
});
