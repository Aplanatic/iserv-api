import { describe, expect, test } from "vitest";
import { AuthBroker, type HtmlStructureSummary } from "../../src/index.js";

const shouldRun = process.env.ISERV_LIVE === "1";
const SAFE_OVERVIEW_ROUTES = [
  "exercise.list",
  "exercise.past",
  "timetable.overview",
  "poll.list",
  "forums.list",
  "news.list",
  "course_selection.list",
  "mailing_lists.list",
  "print.overview",
] as const;

describe.skipIf(!shouldRun)("live keychain-backed read contracts", () => {
  test.each(SAFE_OVERVIEW_ROUTES)("%s returns a structural HTML summary", async (routeId) => {
    const client = await new AuthBroker().restore();
    const result = await client.executeReadRoute(routeId);
    const summary = result.data as HtmlStructureSummary;

    expect(result.status).toBe(200);
    expect(summary.kind).toBe("html-structure");
    expect(summary.bytes).toBeGreaterThan(0);
    expect(JSON.stringify(summary)).not.toMatch(/<html|href=|@|cookie|token/i);
  });
});
