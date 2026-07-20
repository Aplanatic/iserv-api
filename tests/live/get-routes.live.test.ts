import { describe, expect, test } from "vitest";
import { AuthBroker, type HtmlExtractedData } from "../../src/index.js";

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
  "account.info",
  "account.settings",
  "account.last_logins",
  "users.personal",
  "calendar.overview",
  "files.overview",
  "mail.overview",
  "messenger.overview",
  "messenger.direct_form",
  "app.legal",
  "etherpad.list",
  "groupview.overview",
  "help.overview",
  "office.overview",
  "conference.overview",
] as const;

describe.skipIf(!shouldRun)("live keychain-backed read contracts", () => {
  test.each(SAFE_OVERVIEW_ROUTES)("%s returns extracted or structured data", async (routeId) => {
    const client = await new AuthBroker().restore();
    const result = await client.executeReadRoute(routeId);

    expect(result.status).toBe(200);
    expect(result.data).toBeTruthy();
    if (
      result.data &&
      typeof result.data === "object" &&
      "kind" in result.data &&
      (result.data as HtmlExtractedData).kind === "html-extracted"
    ) {
      expect((result.data as HtmlExtractedData).bytes).toBeGreaterThan(0);
    }
    expect(JSON.stringify(result.data)).not.toMatch(/<html|href=|cookie|token/i);
  });

  test("account-scoped profile, search, and WebDAV reads work without mutation", async () => {
    const broker = new AuthBroker();
    const status = await broker.status();
    const username = status.account?.username;
    expect(username).toBeTruthy();
    const client = await broker.restore();

    const [profile, searchResults, webdavEntries] = await Promise.all([
      client.users.getInfo(username as string),
      client.users.search(username as string),
      client.files.getClient().getDirectoryContents("/"),
    ]);

    expect(profile).toBeTypeOf("object");
    expect(searchResults).toBeInstanceOf(Array);
    expect(webdavEntries).toBeInstanceOf(Array);
  });
});
