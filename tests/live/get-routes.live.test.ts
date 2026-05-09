import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { IServAPI } from "../../src/index.js";

const envPath = path.resolve(process.cwd(), ".env");
const hasEnvFile = fs.existsSync(envPath);

function loadDotEnv(): void {
  if (!hasEnvFile) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");

    process.env[key] ??= value;
  }
}

loadDotEnv();

const server = process.env.ISERV_URL;
const username = process.env.ISERV_USER;
const password = process.env.ISERV_PASS;
const shouldRunLiveTests = hasEnvFile || Boolean(server && username && password);

describe.skipIf(!shouldRunLiveTests)("live IServ GET routes", () => {
  let client: IServAPI;

  beforeAll(async () => {
    if (!server || !username || !password) {
      throw new Error(".env must set ISERV_URL, ISERV_USER and ISERV_PASS for live tests.");
    }

    client = await IServAPI.connect(server, username, password);
  });

  afterAll(async () => {
    await client?.disconnect();
  });

  test("calendar GET routes return parseable data", async () => {
    const start = new Date();
    const end = new Date(start);
    end.setDate(start.getDate() + 7);

    const [upcoming, sources, events, searchResults] = await Promise.all([
      client.calendar.getUpcomingEvents(),
      client.calendar.getEventSources(),
      client.calendar.getEvents(start.toISOString(), end.toISOString()),
      client.calendar.searchEvents("test", start.toISOString(), end.toISOString()),
    ]);

    expect(Array.isArray(upcoming.events)).toBe(true);
    expect(Array.isArray(upcoming.errors)).toBe(true);
    expect(Array.isArray(sources)).toBe(true);
    expect(events).toBeTypeOf("object");
    expect(Array.isArray(searchResults)).toBe(true);
  });

  test("email GET routes return parseable data", async () => {
    const emails = await client.email.getEmails({ limit: 1 });

    expect(Array.isArray(emails.items)).toBe(true);
    expect(emails.total).toBeTypeOf("number");

    const firstEmail = emails.items[0];
    if (firstEmail) {
      const message = await client.email.getMessage(firstEmail.id.uid);
      expect(message.envelope.id.uid).toBe(firstEmail.id.uid);
    }
  });

  test("file GET routes return parseable data", async () => {
    const [diskSpace, folderSize] = await Promise.all([
      client.files.getDiskSpace(),
      client.files.getFolderSize("/Files"),
    ]);

    expect(Array.isArray(diskSpace)).toBe(true);
    expect(folderSize.size).toBeTypeOf("string");
  });

  test("notification GET routes return parseable data", async () => {
    const [notifications, badges] = await Promise.all([
      client.notifications.getAll(),
      client.notifications.getBadges(),
    ]);

    expect(notifications.lastEventId).toBeTypeOf("number");
    expect(notifications.count).toBeTypeOf("number");
    expect(Array.isArray(notifications.notifications)).toBe(true);
    if (notifications.since !== null) {
      expect(notifications.since.date).toBeTypeOf("string");
      expect(notifications.since.timezone).toBeTypeOf("string");
    }
    if (notifications.read !== undefined) {
      expect(Array.isArray(notifications.read)).toBe(true);
      if (notifications.read.length > 0) {
        expect(notifications.read[0].id).toBeTypeOf("number");
        expect(notifications.read[0].type).toBeTypeOf("string");
      }
    }
    expect(badges).toBeTypeOf("object");
  });

  test("user GET routes return parseable data", async () => {
    const [ownInfo, autocomplete, searchResults, avatar] = await Promise.all([
      client.users.getOwnInfo(),
      client.users.searchAutocomplete(username ?? "", 5),
      client.users.search(username ?? ""),
      client.users.getOwnProfilePictureBuffer(),
    ]);

    expect(ownInfo.name).toBeTypeOf("string");
    expect(Array.isArray(autocomplete)).toBe(true);
    expect(Array.isArray(searchResults)).toBe(true);
    expect(avatar).toBeInstanceOf(Uint8Array);
    expect(avatar.byteLength).toBeGreaterThan(0);
  });

  test("conference GET route returns parseable data", async () => {
    const health = await client.conference.getHealth();

    expect(health).toBeTypeOf("object");
    expect(health.counter).toBeTypeOf("object");
  });
});
