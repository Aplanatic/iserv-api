import { beforeEach, describe, expect, test, vi } from "vitest";
import { EmailService } from "../src/Email/EmailService.js";
import { createMockIServSession } from "./helpers/mockIServSession.js";

const nodemailerMocks = vi.hoisted(() => ({
  close: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  socketDestroy: vi.fn(),
  socketSetTimeout: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: nodemailerMocks.createTransport,
  },
}));

const ACCOUNT_ID = "test.user@iserv.example";
const INBOX_ID = Buffer.from("INBOX").toString("base64").replace(/=/g, "");

const EMAIL_LIST = {
  items: [
    {
      date: "2026-05-06T09:28:45+02:00",
      id: { accountId: ACCOUNT_ID, mailboxId: INBOX_ID, uid: 1 },
      mailboxInfo: { name: "Posteingang", path: INBOX_ID, type: "inbox" },
      from: [
        {
          host: "iserv.example",
          mailbox: "sender",
          bare_address: "sender@iserv.example",
          personal: "Sender",
          contact: null,
        },
      ],
      to: [
        {
          host: "iserv.example",
          mailbox: "test.user",
          bare_address: ACCOUNT_ID,
          personal: "Test User",
          contact: null,
        },
      ],
      subject: "Test",
      size: 100,
      attachmentCount: 0,
      tags: [],
      read: false,
      flagged: false,
      answered: false,
      forwarded: false,
      messageId: "<abc@iserv.example>",
    },
  ],
  offset: 0,
  total: 1,
  all: 1,
};

describe("EmailService", () => {
  beforeEach(() => {
    nodemailerMocks.close.mockReset();
    nodemailerMocks.createTransport.mockReset();
    nodemailerMocks.sendMail.mockReset();
    nodemailerMocks.socketDestroy.mockReset();
    nodemailerMocks.socketSetTimeout.mockReset();
    nodemailerMocks.createTransport.mockReturnValue({
      close: nodemailerMocks.close,
      sendMail: nodemailerMocks.sendMail,
      transporter: {
        _connections: [
          {
            connection: {
              _socket: {
                destroyed: false,
                destroy: nodemailerMocks.socketDestroy,
                setTimeout: nodemailerMocks.socketSetTimeout,
              },
            },
          },
        ],
      },
    });
    nodemailerMocks.sendMail.mockResolvedValue({});
  });

  test("getEmails returns parsed list", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      username: "test.user",
      routes: [
        {
          method: "get",
          url: `https://iserv.example/iserv/mail/api/v2/account/${encodeURIComponent(ACCOUNT_ID)}/message`,
          params: { "mailbox[]": INBOX_ID, limit: 25, offset: 0, sort: "date", order: "desc" },
          headers: { "X-ISERV-CSRF-PROTECTION": "yes pls" },
          response: { data: JSON.stringify(EMAIL_LIST) },
        },
      ],
    });

    const result = await new EmailService(session).getEmails();
    expect(result.total).toBe(1);
    expect(result.items[0].subject).toBe("Test");
    expectAllRoutesCalled();
  });

  test("getMessage returns parsed message", async () => {
    const message = {
      envelope: {
        ...EMAIL_LIST.items[0],
        replyTo: [],
        cc: [],
        bcc: [],
        via: [],
        unsent: false,
        dsn: false,
        mdn: false,
        mdnRequested: false,
        mdnSent: false,
        mdnDenied: false,
        context: null,
      },
      content: { rich: [], plain: [{ type: "text", partId: "1", content: "Hello" }] },
      attachments: [],
      inlineMedia: [],
      unknownMedia: [],
    };

    const { session, expectAllRoutesCalled } = createMockIServSession({
      username: "test.user",
      routes: [
        {
          method: "get",
          url: `https://iserv.example/iserv/mail/api/v2/account/${encodeURIComponent(ACCOUNT_ID)}/mailbox/${INBOX_ID}/message/1`,
          headers: { "X-ISERV-CSRF-PROTECTION": "yes pls" },
          response: { data: JSON.stringify(message) },
        },
      ],
    });

    const result = await new EmailService(session).getMessage(1);
    expect(result.content.plain[0].content).toBe("Hello");
    expectAllRoutesCalled();
  });

  test("getEmails throws on non-JSON response", async () => {
    const { session } = createMockIServSession({
      username: "test.user",
      routes: [
        {
          method: "get",
          url: `https://iserv.example/iserv/mail/api/v2/account/${encodeURIComponent(ACCOUNT_ID)}/message`,
          params: { "mailbox[]": INBOX_ID, limit: 25, offset: 0, sort: "date", order: "desc" },
          headers: { "X-ISERV-CSRF-PROTECTION": "yes pls" },
          response: { data: "<html></html>" },
        },
      ],
    });

    await expect(new EmailService(session).getEmails()).rejects.toThrow("Expected JSON response");
  });

  test("sendEmail closes the SMTP transporter after sending", async () => {
    const { session } = createMockIServSession({ username: "test.user", routes: [] });
    const service = new EmailService(session);

    await service.sendEmail({
      to: "recipient@iserv.example",
      subject: "Test",
      body: "Hello",
    });

    expect(nodemailerMocks.createTransport).toHaveBeenCalledWith({
      host: "iserv.example",
      port: 465,
      secure: true,
      auth: { user: "test.user", pass: "secret" },
      pool: true,
      maxConnections: 1,
      logger: false,
      debug: false,
    });
    expect(nodemailerMocks.sendMail).toHaveBeenCalledWith({
      from: ACCOUNT_ID,
      to: "recipient@iserv.example",
      subject: "Test",
      text: "Hello",
      html: undefined,
      attachments: [],
    });
    expect(nodemailerMocks.close).toHaveBeenCalledTimes(1);
    expect(nodemailerMocks.socketSetTimeout).toHaveBeenCalledWith(0);
    expect(nodemailerMocks.socketDestroy).toHaveBeenCalledTimes(1);
  });

  describe("getEmails validation", () => {
    test("throws when limit=0", async () => {
      const { session } = createMockIServSession({ username: "test.user", routes: [] });
      await expect(new EmailService(session).getEmails({ limit: 0 })).rejects.toThrow(
        "limit must be between 1 and 1000",
      );
    });

    test("throws when limit=1001", async () => {
      const { session } = createMockIServSession({ username: "test.user", routes: [] });
      await expect(new EmailService(session).getEmails({ limit: 1001 })).rejects.toThrow(
        "limit must be between 1 and 1000",
      );
    });

    test("throws when limit=-1", async () => {
      const { session } = createMockIServSession({ username: "test.user", routes: [] });
      await expect(new EmailService(session).getEmails({ limit: -1 })).rejects.toThrow(
        "limit must be between 1 and 1000",
      );
    });

    test("throws when offset=-1", async () => {
      const { session } = createMockIServSession({ username: "test.user", routes: [] });
      await expect(new EmailService(session).getEmails({ offset: -1 })).rejects.toThrow(
        "offset must be a non-negative integer",
      );
    });

    test("does NOT throw when limit=1 offset=0", async () => {
      const { session } = createMockIServSession({
        username: "test.user",
        routes: [
          {
            method: "get",
            url: `https://iserv.example/iserv/mail/api/v2/account/${encodeURIComponent(ACCOUNT_ID)}/message`,
            params: { "mailbox[]": INBOX_ID, limit: 1, offset: 0, sort: "date", order: "desc" },
            headers: { "X-ISERV-CSRF-PROTECTION": "yes pls" },
            response: { data: JSON.stringify({ items: [], offset: 0, total: 0, all: 0 }) },
          },
        ],
      });
      await expect(
        new EmailService(session).getEmails({ limit: 1, offset: 0 }),
      ).resolves.toBeDefined();
    });

    test("does NOT throw when limit=1000", async () => {
      const { session } = createMockIServSession({
        username: "test.user",
        routes: [
          {
            method: "get",
            url: `https://iserv.example/iserv/mail/api/v2/account/${encodeURIComponent(ACCOUNT_ID)}/message`,
            params: { "mailbox[]": INBOX_ID, limit: 1000, offset: 0, sort: "date", order: "desc" },
            headers: { "X-ISERV-CSRF-PROTECTION": "yes pls" },
            response: { data: JSON.stringify({ items: [], offset: 0, total: 0, all: 0 }) },
          },
        ],
      });
      await expect(new EmailService(session).getEmails({ limit: 1000 })).resolves.toBeDefined();
    });
  });

  describe("getMessage validation", () => {
    test("throws when uid=0", async () => {
      const { session } = createMockIServSession({ username: "test.user", routes: [] });
      await expect(new EmailService(session).getMessage(0)).rejects.toThrow(
        "uid must be a positive integer",
      );
    });

    test("throws when uid=-1", async () => {
      const { session } = createMockIServSession({ username: "test.user", routes: [] });
      await expect(new EmailService(session).getMessage(-1)).rejects.toThrow(
        "uid must be a positive integer",
      );
    });

    test("throws when uid is a float", async () => {
      const { session } = createMockIServSession({ username: "test.user", routes: [] });
      await expect(new EmailService(session).getMessage(1.5)).rejects.toThrow(
        "uid must be a positive integer",
      );
    });

    test("does NOT throw when uid=1", async () => {
      const message = {
        envelope: {
          ...EMAIL_LIST.items[0],
          replyTo: [],
          cc: [],
          bcc: [],
          via: [],
          unsent: false,
          dsn: false,
          mdn: false,
          mdnRequested: false,
          mdnSent: false,
          mdnDenied: false,
          context: null,
        },
        content: { rich: [], plain: [{ type: "text", partId: "1", content: "Hello" }] },
        attachments: [],
        inlineMedia: [],
        unknownMedia: [],
      };
      const { session } = createMockIServSession({
        username: "test.user",
        routes: [
          {
            method: "get",
            url: `https://iserv.example/iserv/mail/api/v2/account/${encodeURIComponent(ACCOUNT_ID)}/mailbox/${INBOX_ID}/message/1`,
            headers: { "X-ISERV-CSRF-PROTECTION": "yes pls" },
            response: { data: JSON.stringify(message) },
          },
        ],
      });
      await expect(new EmailService(session).getMessage(1)).resolves.toBeDefined();
    });
  });

  describe("sendEmail validation", () => {
    test("throws when to is not a valid email", async () => {
      const { session } = createMockIServSession({ username: "test.user", routes: [] });
      await expect(
        new EmailService(session).sendEmail({ to: "notanemail", subject: "Hi", body: "Hello" }),
      ).rejects.toThrow("Invalid email address");
    });

    test("throws when to has missing domain", async () => {
      const { session } = createMockIServSession({ username: "test.user", routes: [] });
      await expect(
        new EmailService(session).sendEmail({ to: "missing@", subject: "Hi", body: "Hello" }),
      ).rejects.toThrow("Invalid email address");
    });

    test("does NOT throw for valid email", async () => {
      const { session } = createMockIServSession({ username: "test.user", routes: [] });
      nodemailerMocks.sendMail.mockResolvedValueOnce({});
      await expect(
        new EmailService(session).sendEmail({
          to: "recipient@iserv.example",
          subject: "Hi",
          body: "Hello",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("markAsUnread", () => {
    test("sends PATCH with remove Seen flag and returns result", async () => {
      const result = {
        oldId: { accountId: ACCOUNT_ID, mailboxId: INBOX_ID, uid: 1 },
        newId: { accountId: ACCOUNT_ID, mailboxId: INBOX_ID, uid: 1 },
      };
      const { session, calls, expectAllRoutesCalled } = createMockIServSession({
        username: "test.user",
        routes: [
          {
            method: "patch",
            url: `https://iserv.example/iserv/mail/api/v2/account/${encodeURIComponent(ACCOUNT_ID)}/mailbox/${INBOX_ID}/message/1`,
            headers: { "X-ISERV-CSRF-PROTECTION": "yes pls", "Content-Type": "application/json" },
            response: { data: JSON.stringify(result) },
          },
        ],
      });

      const res = await new EmailService(session).markAsUnread(1);
      expect(res.oldId.uid).toBe(1);
      expect(res.newId.uid).toBe(1);
      expect(calls[0]?.body).toBe(JSON.stringify({ flags: { remove: ["\\Seen"] } }));
      expectAllRoutesCalled();
    });

    test("throws when uid=0", async () => {
      const { session } = createMockIServSession({ username: "test.user", routes: [] });
      await expect(new EmailService(session).markAsUnread(0)).rejects.toThrow(
        "uid must be a positive integer",
      );
    });
  });

  describe("markAsRead", () => {
    test("sends PATCH with add Seen flag and returns result", async () => {
      const result = {
        oldId: { accountId: ACCOUNT_ID, mailboxId: INBOX_ID, uid: 5 },
        newId: { accountId: ACCOUNT_ID, mailboxId: INBOX_ID, uid: 5 },
      };
      const { session, calls, expectAllRoutesCalled } = createMockIServSession({
        username: "test.user",
        routes: [
          {
            method: "patch",
            url: `https://iserv.example/iserv/mail/api/v2/account/${encodeURIComponent(ACCOUNT_ID)}/mailbox/${INBOX_ID}/message/5`,
            headers: { "X-ISERV-CSRF-PROTECTION": "yes pls", "Content-Type": "application/json" },
            response: { data: JSON.stringify(result) },
          },
        ],
      });

      const res = await new EmailService(session).markAsRead(5);
      expect(res.oldId.uid).toBe(5);
      expect(calls[0]?.body).toBe(JSON.stringify({ flags: { add: ["\\Seen"] } }));
      expectAllRoutesCalled();
    });

    test("throws when uid=-1", async () => {
      const { session } = createMockIServSession({ username: "test.user", routes: [] });
      await expect(new EmailService(session).markAsRead(-1)).rejects.toThrow(
        "uid must be a positive integer",
      );
    });
  });

  test("sendEmail closes the SMTP transporter when sending fails", async () => {
    nodemailerMocks.sendMail.mockRejectedValueOnce(new Error("SMTP failed"));
    const { session } = createMockIServSession({ username: "test.user", routes: [] });
    const service = new EmailService(session);

    await expect(
      service.sendEmail({
        to: "recipient@iserv.example",
        subject: "Test",
        body: "Hello",
      }),
    ).rejects.toThrow("SMTP failed");

    expect(nodemailerMocks.close).toHaveBeenCalledTimes(1);
    expect(nodemailerMocks.socketDestroy).toHaveBeenCalledTimes(1);
  });
});
