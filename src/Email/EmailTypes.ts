export interface EmailAddress {
  host: string;
  mailbox: string;
  bare_address: string;
  personal: string | null;
  contact: null;
}

export interface EmailId {
  accountId: string;
  mailboxId: string;
  uid: number;
}

export interface MailboxInfo {
  name: string;
  path: string;
  type: string;
}

export interface EmailListItem {
  date: string;
  id: EmailId;
  mailboxInfo: MailboxInfo;
  from: EmailAddress[];
  to: EmailAddress[];
  subject: string;
  size: number;
  attachmentCount: number;
  tags: string[];
  read: boolean;
  flagged: boolean;
  answered: boolean;
  forwarded: boolean;
  messageId: string;
}

export interface EmailList {
  items: EmailListItem[];
  offset: number;
  total: number;
  all: number;
}

export interface EmailContentPart {
  type: string;
  partId: string;
  content: string;
}

export interface EmailEnvelope extends EmailListItem {
  replyTo: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  via: EmailAddress[];
  unsent: boolean;
  dsn: boolean;
  mdn: boolean;
  mdnRequested: boolean;
  mdnSent: boolean;
  mdnDenied: boolean;
  context: null;
}

export interface EmailMessage {
  envelope: EmailEnvelope;
  content: {
    rich: EmailContentPart[];
    plain: EmailContentPart[];
  };
  attachments: unknown[];
  inlineMedia: unknown[];
  unknownMedia: unknown[];
}

export interface GetEmailsOptions {
  mailbox?: string;
  limit?: number;
  offset?: number;
  sort?: "date" | (string & {});
  order?: "asc" | "desc";
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
  htmlBody?: string;
  smtpServer?: string;
  smtpsPort?: number;
  attachments?: string[];
}
