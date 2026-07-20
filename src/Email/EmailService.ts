import * as fs from "node:fs/promises";
import * as path from "node:path";
import type nodemailer from "nodemailer";
import { IServApiError } from "../Core/Errors.js";
import { parseJson } from "../Core/HttpClient.js";
import type { IServSession } from "../Core/IServSession.js";
import { createLogger } from "../Core/Logger.js";
import type {
  EmailList,
  EmailMessage,
  GetEmailsOptions,
  PatchMessageResult,
  SendEmailOptions,
} from "./EmailTypes.js";

const log = createLogger("Email");

const CSRF_HEADERS = { "X-ISERV-CSRF-PROTECTION": "yes pls" };

function encodeMailboxId(mailbox: string): string {
  return Buffer.from(mailbox).toString("base64").replace(/=/g, "");
}

type ClosableSocket = {
  destroyed?: boolean;
  destroy?: () => void;
  setTimeout?: (timeout: number) => void;
  socket?: ClosableSocket;
};

type NodemailerPool = {
  transporter?: {
    _connections?: Array<{ connection?: { _socket?: ClosableSocket } }>;
  };
};

function destroyOpenSmtpSockets(transporter: nodemailer.Transporter): void {
  const pool = (transporter as nodemailer.Transporter & NodemailerPool).transporter;
  const connections = pool?._connections ?? [];

  for (const resource of connections) {
    const socket = resource.connection?._socket?.socket ?? resource.connection?._socket;
    if (!socket || socket.destroyed || typeof socket.destroy !== "function") continue;
    socket.setTimeout?.(0);
    socket.destroy();
  }
}

export class EmailService {
  constructor(private readonly session: IServSession) {}

  private get accountId(): string {
    return `${this.session.username}@${this.session.url}`;
  }

  async getEmails(options: GetEmailsOptions = {}): Promise<EmailList> {
    const { mailbox = "INBOX", limit = 25, offset = 0, sort = "date", order = "desc" } = options;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) {
      throw new IServApiError("limit must be between 1 and 1000", 400);
    }
    if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
      throw new IServApiError("offset must be a non-negative integer", 400);
    }
    const mailboxId = encodeMailboxId(mailbox);
    const res = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/mail/api/v2/account/${encodeURIComponent(this.accountId)}/message`,
      { params: { "mailbox[]": mailboxId, limit, offset, sort, order }, headers: CSRF_HEADERS },
    );
    log.info("Got emails");
    return parseJson<EmailList>(res.data, "emails");
  }

  async getMessage(uid: number, mailbox = "INBOX"): Promise<EmailMessage> {
    if (!Number.isInteger(uid) || uid <= 0) {
      throw new IServApiError("uid must be a positive integer", 400);
    }
    const mailboxId = encodeMailboxId(mailbox);
    const res = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/mail/api/v2/account/${encodeURIComponent(this.accountId)}/mailbox/${mailboxId}/message/${uid}`,
      { headers: CSRF_HEADERS },
    );
    log.info("Got message");
    return parseJson<EmailMessage>(res.data, "message");
  }

  private async patchFlags(
    uid: number,
    mailbox: string,
    flags: { add?: string[]; remove?: string[] },
  ): Promise<PatchMessageResult> {
    if (!Number.isInteger(uid) || uid <= 0) {
      throw new IServApiError("uid must be a positive integer", 400);
    }
    const mailboxId = encodeMailboxId(mailbox);
    const res = await this.session.http.patch(
      `${this.session.baseUrl()}/iserv/mail/api/v2/account/${encodeURIComponent(this.accountId)}/mailbox/${mailboxId}/message/${uid}`,
      JSON.stringify({ flags }),
      { headers: { ...CSRF_HEADERS, "Content-Type": "application/json" } },
    );
    log.info(`Patched flags for message ${uid}`);
    return parseJson<PatchMessageResult>(res.data, "patch message flags");
  }

  async markAsRead(uid: number, mailbox = "INBOX"): Promise<PatchMessageResult> {
    return this.patchFlags(uid, mailbox, { add: ["\\Seen"] });
  }

  async markAsUnread(uid: number, mailbox = "INBOX"): Promise<PatchMessageResult> {
    return this.patchFlags(uid, mailbox, { remove: ["\\Seen"] });
  }

  async sendEmail(options: SendEmailOptions): Promise<void> {
    const { default: nodemailer } = await import("nodemailer");
    const { to, subject, body, htmlBody, smtpServer, smtpsPort = 465, attachments = [] } = options;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new IServApiError("Invalid email address", 400);
    }

    const server = smtpServer ?? this.session.url;
    if (server !== this.session.url) {
      throw new IServApiError(
        `smtpServer must match the configured IServ domain "${this.session.url}"`,
        400,
      );
    }

    if (smtpsPort !== 465 && smtpsPort !== 587) {
      throw new IServApiError("smtpsPort must be 465 or 587", 400);
    }

    for (const filePath of attachments) {
      if (
        filePath.includes("\0") ||
        filePath.split(/[\\/]/).includes("..") ||
        path.isAbsolute(filePath)
      ) {
        throw new IServApiError("Invalid attachment path", 400);
      }
      await fs.access(filePath).catch(() => {
        throw new IServApiError(`Attachment not found: "${path.basename(filePath)}"`, 400);
      });
    }

    const transporter = nodemailer.createTransport({
      host: server,
      port: smtpsPort,
      secure: true,
      auth: { user: this.session.username, pass: this.session.getPassword() },
      pool: true,
      maxConnections: 1,
      logger: false,
      debug: false,
    });

    try {
      await transporter.sendMail({
        from: `${this.session.username}@${this.session.url}`,
        to,
        subject,
        text: body,
        html: htmlBody,
        attachments: attachments.map((filePath) => ({
          path: filePath,
          filename: path.basename(filePath),
        })),
      });
    } finally {
      transporter.close();
      destroyOpenSmtpSockets(transporter);
    }
    log.info("Email sent");
  }
}
