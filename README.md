# Aplanatic IServ API

Unofficial TypeScript SDK, canonical normal-user route catalog, native-keychain profile
authentication, and local route explorer for IServ school management servers.
It does not bypass permissions or require an administrator-created OAuth client.

## Installation

Packages are distributed through GitHub Packages. Configure npm authentication for the
`@aplanatic` scope, then install:

```sh
npm install @aplanatic/iserv-api --registry=https://npm.pkg.github.com
```

## Basic usage

```ts
import { IServClient } from "@aplanatic/iserv-api";

const api = await IServClient.connect("iserv.example", "username", "password");

const info = await api.users.getOwnInfo();
console.log(info);

await api.disconnect();
```

For reusable sessions, use `AuthBroker`; credentials, scoped session cookies, and tokens
are stored only in the operating system credential store so WebDAV and session renewal
continue to work after a restart. `routeCatalog` exposes typed route metadata and
`npm run explorer:dev` starts the three-pane documentation explorer. Its live proxy
is loopback-only, launch-token protected, redacted, and limited to catalogued GET routes.

HTTP requests default to a 30s timeout (`ISERV_TIMEOUT_MS`), retry selected 429 responses,
and send a browser-like `User-Agent` that includes the `Aplanatic-IServ/<version>` product
token (override with `ISERV_USER_AGENT` when needed).

### AuthBroker profiles

```ts
import { AuthBroker } from "@aplanatic/iserv-api";

const broker = new AuthBroker();

// Password login; omit password from the keychain when ephemeral is true
await broker.login({
  profile: "school",
  url: "iserv.example",
  username: "alice",
  password: "…",
  ephemeral: false,
});

// System browser login (Chrome/Edge/Chromium; no Playwright download)
await broker.loginBrowser({
  profile: "school",
  url: "iserv.example",
  username: "alice",
  timeoutMs: 180_000,
});

const api = await broker.restore(); // active profile
await broker.restoreMessenger(); // renew scoped Matrix session if needed
await broker.status(); // display name, username, module capabilities
await broker.logout(); // one profile
await broker.logoutAll(); // every stored profile
```

Ephemeral sessions keep cookies for reuse in-process but drop the password from the
keychain, so SMTP and WebDAV (which need the stored password) will not work until a full
login. Cross-origin HTTP redirects are rejected before the destination is contacted.

## Read-only module discovery

The catalog includes live-verified normal-user overview routes for exercises, timetable,
polls, forums, news, course selection, mailing lists, and printing. Execute one only by
its fixed catalog ID:

```ts
const client = await new AuthBroker().restore();
const result = await client.executeReadRoute("exercise.list");
```

When a route has a structured loader (timetable grid, news lists, and similar), that
payload is returned (redacted). Otherwise authenticated HTML is parsed into an
`HtmlExtractedData` value (`kind: "html-extracted"`): title, tables, key/value pairs,
lists, sections, and items — never raw HTML markup. Experimental or write-capable routes
are rejected by `executeReadRoute`. Local contract checks reuse the native-keychain profile
and can be enabled explicitly with `ISERV_LIVE=1 npm run test:live`; no credential file is
read or supported.

`AuthBroker.status()` also returns the signed-in display name, username, and an honest
module capability inventory. It distinguishes available modules from experimental,
unavailable, and non-installed integrations. Operation counts describe catalog coverage;
write permissions are still enforced by the instance when an action is invoked.

Restored profiles preserve their scoped Matrix session in the native keychain. Older
profiles can renew it with `AuthBroker.restoreMessenger()` without asking for credentials
again.

Use `presentForDisplay(value)` when you want the same human-oriented projection the CLI
uses for mail, rooms, account, and module payloads (JSON automation should keep the
redacted original). Structured module pages are also available directly as
`api.modules.listNews()`, `listExercises()`, `listPolls()`, and related helpers.

## Fast search and bounded batches

Route-only consumers can avoid loading the full network SDK:

```ts
import { routeCatalog } from "@aplanatic/iserv-api/catalog";
import { redactValue } from "@aplanatic/iserv-api/redaction";

const matches = routeCatalog.search("calendar events", {
  module: "calendar",
  method: "GET",
  sideEffect: "read",
  status: "supported",
  limit: 10,
});
```

Search is multi-term, ranked, deterministic, and filterable. For agents or CLIs that need
several independent overview pages, reuse one restored client and run a bounded batch:

```ts
const client = await new AuthBroker().restore();
const results = await client.executeReadRoutes(
  [
    { routeId: "calendar.overview" },
    { routeId: "etherpad.list" },
    { routeId: "groupview.overview" },
  ],
  { concurrency: 3 },
);
```

The batch limit is eight. Every request is validated against the same GET/session/read/
supported policy as `executeReadRoute`; arbitrary URLs and mutation routes are rejected.
Identity and module checks run concurrently, and browser/SMTP dependencies load only when
used.

## Coverage status

The current catalog contains 71 routes in 25 modules: 65 supported, five experimental,
and one documented-only CalDAV route. Forty-eight of 50 supported reads have a current
live verification marker. Opening an individual mail message is not live-verified because
some installations may change its read state; `auth.logout` is likewise omitted from the
safe live suite. Mutation routes are catalogued and tested with mocks, not executed on the
real account. The local live suite currently runs 25 safe checks.

## Security and privacy

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability. Never post a real
instance hostname, username, screenshot, HAR file, cookie, token, password, or live
response in an issue or pull request. Security reports must use GitHub private
vulnerability reporting.

Repository CI scans both the current tree and complete reachable Git history. Network
clients require HTTPS, reject unsafe instance targets by default, and block cross-origin
authentication redirects. The explorer binds only to loopback and accepts only tokenized,
catalogued read requests.

See [CONTRIBUTING.md](CONTRIBUTING.md) for sanitized route and test requirements.

## Table of contents

- [Installation](#installation)
- [Basic usage](#basic-usage)
- [Read-only module discovery](#read-only-module-discovery)
- [Fast search and bounded batches](#fast-search-and-bounded-batches)
- [Coverage status](#coverage-status)
- [Security and privacy](#security-and-privacy)
- [Supported functionality](#supported-functionality)
  - [Own account](#own-account)
  - [Users](#users)
  - [Email](#email)
  - [Calendar](#calendar)
  - [Timetable](#timetable)
  - [Files](#files)
  - [Messenger](#messenger)
  - [Conference](#conference)
- [Logging](#logging)
- [License](#license)

---

## Supported functionality

### Own account

#### Get own user info

```ts
const info = await api.users.getOwnInfo();
```

Returns name, email, groups, roles, rights, and public profile info of the logged-in user.

#### Set own user info

```ts
await api.users.setOwnInfo({
  nickname: "Ali",
  city: "Berlin",
  hidden: false,
});
```

Available fields: `title`, `company`, `birthday`, `nickname`, `schoolClass`, `street`, `zipcode`, `city`, `country`, `phone`, `mobilePhone`, `fax`, `mail`, `homepage`, `icq`, `jabber`, `msn`, `skype`, `note`, `hidden`

#### Get notifications

```ts
const data = await api.notifications.getAll();
```

Returns all notifications including unread count and notification items.

#### Get badges

```ts
const badges = await api.notifications.getBadges();
```

Returns sidebar badge counts (e.g. unread email count).

#### Read all notifications

```ts
await api.notifications.readAll();
```

Marks all notifications as read.

#### Read a notification

```ts
await api.notifications.read(123);
```

Marks a single notification as read by its ID.

---

### Users

#### Get profile picture

```ts
await api.users.getProfilePicture("alice", "./avatars");
```

Saves the user's profile picture to the specified folder as `{username}.{ext}`.

#### Get profile picture buffer

```ts
const buffer = await api.users.getProfilePictureBuffer("alice");
const buffer = await api.users.getProfilePictureBuffer("alice", 128, 128);
const own = await api.users.getOwnProfilePictureBuffer(128, 128);
```

Returns the profile picture as a `Buffer`. Width and height must be positive integers between 1 and 4096. `getOwnProfilePictureBuffer` is the signed-in user shortcut.

#### Get user info

```ts
const info = await api.users.getInfo("alice");
```

Returns the public address book information of any user.

#### Search users

```ts
const results = await api.users.search("Alice");
```

Searches the address book. Returns an array of `{ name, userUrl }`.

#### Search users autocomplete

```ts
const results = await api.users.searchAutocomplete("ali", 10);
```

Faster autocomplete search. Returns up to `limit` results (default 50).

#### Search messenger recipients

```ts
const recipients = await api.users.searchMessengerRecipients("Alice Example");
const alice = recipients[0];
```

Searches IServ's messenger recipient autocomplete endpoint. This is useful for messenger operations such as `createDirectMessage()`, where the returned `value` is the recipient identifier expected by IServ.

---

### Email

#### Get emails

```ts
const emails = await api.email.getEmails({
  mailbox: "INBOX",
  limit: 25,
  offset: 0,
  sort: "date",
  order: "desc",
});
```

#### Get message

```ts
const message = await api.email.getMessage(uid, "INBOX");
```

Returns the full message including headers, body parts, and attachment metadata.

#### Send email

```ts
await api.email.sendEmail({
  to: "recipient@example.com",
  subject: "Hello",
  body: "Plain text body",
  htmlBody: "<p>HTML body</p>",
  smtpsPort: 465,
  attachments: ["./file.pdf"],
});
```

Attachment paths may be relative, absolute, or `~/…` (home expanded). Path traversal
(`..`) is rejected. `smtpsPort` must be `465` or `587`.

#### Mark as unread

```ts
await api.email.markAsUnread(uid);
await api.email.markAsUnread(uid, "INBOX"); // mailbox defaults to "INBOX"
```

Marks a message as unread by its UID.

#### Mark as read

```ts
await api.email.markAsRead(uid);
await api.email.markAsRead(uid, "INBOX");
```

Marks a message as read by its UID.

---

### Calendar

#### Get upcoming events

```ts
const { events } = await api.calendar.getUpcomingEvents();
```

#### Get event sources

```ts
const sources = await api.calendar.getEventSources();
```

Returns all available calendars and plugins. Each source has an `id`, `label`, and `type` (`"cal"` or `"plugin"`).

#### Get events

```ts
const events = await api.calendar.getEvents("2025-01-01", "2025-12-31");
```

Returns all events across all sources in the given time range.

#### Search events

```ts
const results = await api.calendar.searchEvents("Math exam", "2025-01-01", "2025-12-31");
```

#### Get plugin events

```ts
const events = await api.calendar.getPluginEvents("holiday", "2025-01-01", "2025-12-31");
```

Plugin IDs come from event sources where `type === "plugin"`.

#### Get holidays

```ts
const holidays = await api.calendar.getHolidays({ nextLimit: 12 });
```

Builds a school-holiday overview from the holiday plugin (`Ferien` / `Feiertage`) plus
movable free days found on regular calendars. Returns `asOf`, named `seasons`, upcoming
`next` periods, and `movable` free days with countdown status.

#### Create event

```ts
const result = await api.calendar.createEvent({
  subject: "Math exam",
  calendar: "/alice/home",
  start: "2025-09-27T14:00:00",
  end: "2025-09-27T16:00:00",
  location: "Room 101",
  description: "Bring calculator",
  alarms: ["1D", "2H"],
  isAllDayLong: false,
  participants: ["bob", "carol@iserv.example"],
  showMeAs: "OPAQUE",
  privacy: "PUBLIC",
  recurring: {
    intervalType: "WEEKLY",
    interval: 1,
    recurrenceDays: ["MO", "WE"],
    endType: "COUNT",
    endInterval: 10,
  },
});
```

**Alarm types:**

Preset strings: `"0M"` `"5M"` `"15M"` `"30M"` `"1H"` `"2H"` `"12H"` `"1D"` `"2D"` `"7D"`

Custom datetime alarm:
```ts
{ custom_date_time: { dateTime: "2025-09-26T10:00:00" } }
```

Custom interval alarm:
```ts
{
  custom_interval: {
    interval: { days: 1, hours: 2, minutes: 0 },
    before: true,
  }
}
```

**Recurring options:**

| Field | Type | Description |
|---|---|---|
| `intervalType` | `"NO" \| "DAILY" \| "WEEKDAYS" \| "WEEKLY" \| "MONTHLY" \| "YEARLY"` | Repeat pattern |
| `interval` | `number` | Repeat every N units (required for most types) |
| `recurrenceDays` | `WeekDay[]` | Required for `WEEKLY` |
| `monthlyIntervalType` | `"BYMONTHDAY" \| "BYDAY"` | Required for `MONTHLY` |
| `endType` | `"NEVER" \| "COUNT" \| "UNTIL"` | How the recurrence ends |
| `endInterval` | `number` | Required if `endType` is `"COUNT"` |
| `untilDate` | `string` | Required if `endType` is `"UNTIL"`, format `"DD.MM.YYYY"` |

#### Delete event

```ts
await api.calendar.deleteEvent({
  uid: "abc123@iserv.example",
  hash: "541f2d74099d785d1286c03903a2e826",
  calendar: "/alice/home",
  start: "2025-09-27T14:00:00+02:00",
  series: false,
});
```

`uid`, `hash`, `calendar`, and `start` are returned by `getEvents()`.

---

### Timetable

```ts
const meta = await api.timetable.getMeta();
const week = await api.timetable.getWeek({ startDate: "2026-07-20", endDate: "2026-07-26" });
const today = await api.timetable.getToday({ date: "2026-07-20" });
```

Returns the structured lesson grid (periods, subjects, rooms, substitutions) rather than
raw HTML. Visibility still depends on the account's timetable rights on the instance.

---

### Files

#### Get WebDAV client

```ts
const client = api.files.getClient();
```

Returns a pre-authenticated [`webdav`](https://github.com/perry-mitchell/WebDAV-client) client. See the webdav package documentation for all available methods.

```ts
const files = await client.getDirectoryContents("/");
await client.putFileContents("/notes.txt", "hello");
const data = await client.getFileContents("/notes.txt");
```

#### List a WebDAV directory

```ts
const entries = await api.files.listWebDav("/");
```

Convenience wrapper around `getClient().getDirectoryContents`. Requires WebDAV access and a
stored password on the session (not available for many student accounts).

#### Get folder size

```ts
const size = await api.files.getFolderSize("/Documents");
```

#### Get disk space

```ts
const usage = await api.files.getDiskSpace();
```

Returns disk space info for all accessible storage volumes (label, free space, color).

---

### Messenger

The messenger service wraps the Matrix protocol used by IServ. A Matrix session is established automatically during login.

#### Get rooms

```ts
const rooms = await api.messenger.getRooms();
```

Returns all joined rooms (group chats and direct messages). `lastMessage.body` is always a
display string (never a nested object).

#### Get contacts

```ts
const contacts = await api.messenger.getContacts();
```

Resolves Matrix `m.direct` contacts to display names, room IDs, and recent-activity notes.

Each room has:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Matrix room ID |
| `name` | `string` | Room name or display name of the other person |
| `isDirect` | `boolean` | Whether this is a DM |
| `unreadCount` | `number` | Unread message count |
| `lastMessage` | `RoomLastMessage \| null` | Most recent message |

`lastMessage` fields: `body`, `sender` (Matrix user ID), `senderName` (display name, falls back to Matrix user ID), `timestamp`.

#### Get messages

```ts
const { messages, start, end } = await api.messenger.getMessages(roomId, { limit: 30, from: end });
```

Returns up to `limit` messages (default 30) in reverse chronological order. Pass `end` from a previous response as `from` to paginate backwards. `end` is `undefined` when there are no more messages.

Each message has:

| Field | Type | Description                                                                  |
|---|---|------------------------------------------------------------------------------|
| `eventId` | `string` | Matrix event ID                                                              |
| `sender` | `string` | Matrix user ID                                                               |
| `senderName` | `string` | Display name, falls back to the Matrix user ID if unavailable                |
| `body` | `string` | Message text, empty string if the message is end-to-end encrypted            |
| `msgtype` | `string` | e.g. `"m.text"`, `"m.image"`, `"m.file"` — `"m.encrypted"` for E2EE messages |
| `timestamp` | `number` | Unix ms                                                                      |
| `encrypted` | `boolean` | `true` if the message content cannot be decrypted by this SDK                |

#### Get messages by name

```ts
const { messages } = await api.messenger.getMessagesByName("Max Mustermann", { limit: 20 });
```

Looks up the room by name and returns its messages. Throws if no room or multiple rooms match the name. Accepts the same options as `getMessages()`.

#### Get members

```ts
const members = await api.messenger.getMembers(roomId);
```

Returns all current members of a room (excludes users who have left).

Each member has: `userId`, `displayName`, `avatarUrl`, `membership` (`"join"` | `"invite"` | `"ban"` | `"knock"`).

#### Get profile

```ts
const profile = await api.messenger.getProfile(userId);
```

Returns the Matrix profile of any user: `userId`, `displayName`, `avatarUrl`.

#### Send message

```ts
const result = await api.messenger.sendMessage(roomId, "Hello!");
console.log(result.eventId);
```

Sends a text message to a room by its Matrix room ID. Returns the `eventId` of the sent message.

An optional `txnId` can be passed as a third argument for idempotency — if the same `txnId` is used twice, the server will deduplicate the send:

```ts
await api.messenger.sendMessage(roomId, "Hello!", "my-unique-id");
```

#### Create direct message

```ts
const recipients = await api.users.searchMessengerRecipients("Alice Example");
const alice = recipients[0];

if (!alice) throw new Error("User not found");

const { roomId } = await api.messenger.createDirectMessage(alice.value);
```

Creates or opens a direct message room using IServ's messenger form flow. The `matrixId` argument should usually come from `api.users.searchMessengerRecipients(...)[n].value`. Returns the Matrix `roomId`.

#### Leave room

```ts
await api.messenger.leaveRoom(roomId);
```

Leaves a Matrix room by room ID.

#### React to message

```ts
const result = await api.messenger.reactToMessage(roomId, eventId, "👍");
console.log(result.eventId);
```

Adds a reaction to a message. Pass an optional fourth `txnId` for idempotency.

#### Edit message

```ts
const result = await api.messenger.editMessage(roomId, eventId, "Updated text");
console.log(result.eventId);
```

Sends a Matrix replacement event for an existing text message. Pass an optional fourth `txnId` for idempotency.

#### Reply to message

```ts
const { messages } = await api.messenger.getMessages(roomId, { limit: 1 });
const original = messages[0];

const result = await api.messenger.replyToMessage(roomId, original, "Thanks!");
console.log(result.eventId);
```

Sends a text reply. The second argument can be any `Message` object returned by `getMessages()`. Pass an optional fourth `txnId` for idempotency.

#### Remove reaction

```ts
const result = await api.messenger.removeReaction(roomId, reactionEventId);
console.log(result.eventId);
```

Redacts a reaction event. Throws if the reaction doesn't exist or you're not allowed to remove it.

#### Delete message

```ts
const result = await api.messenger.deleteMessage(roomId, eventId);
console.log(result.eventId);
```

Redacts a message event. Throws an error if the message doesn't exist or you're not allowed to delete it.

#### Send message by name

```ts
const result = await api.messenger.sendMessageByName("Max Mustermann", "Hello!");
console.log(result.eventId);
```

Looks up the room by display name and sends a text message. Throws if no room or multiple rooms match the name. Accepts an optional `txnId` as a third argument, same as `sendMessage()`.

> **Note:** This method calls `getRooms()` internally, which makes an extra network request. If you already have the room ID, prefer `sendMessage()` directly.

#### React to message by name

```ts
const result = await api.messenger.reactToMessageByName("Max Mustermann", eventId, "👍");
console.log(result.eventId);
```

Looks up the room by display name and reacts to a message. Throws if no room or multiple rooms match the name. Accepts an optional `txnId` as a fourth argument, same as `reactToMessage()`.

> **Note:** This method calls `getRooms()` internally, which makes an extra network request. If you already have the room ID, prefer `reactToMessage()` directly.

#### Listen for messages

```ts
const listener = await api.messenger.listenForMessages((event, stop) => {
  console.log(`[${event.roomName}] ${event.message.senderName}: ${event.message.body}`);
  stop(); // stop after first message
});

// Stop from outside the callback at any time:
listener.stop();
```

With options:

```ts
const listener = await api.messenger.listenForMessages(
  (event) => {
    console.log(event.message.body);
  },
  {
    pollTimeout: 10000,
    roomIds: [roomId],
    onError: (err) => console.error("sync error:", err),
  },
);
```

Starts a real-time message listener using Matrix long-polling. The callback fires for every incoming `m.room.message` event. A `stop` function is passed as the second argument to the callback for convenience.

| Option | Type | Default | Description |
|---|---|---------|---|
| `pollTimeout` | `number` | `30000` | Long-poll timeout in ms |
| `roomIds` | `string[]` | / | Only emit events from these room IDs |
| `onError` | `(err: Error) => void` | / | Called on sync errors instead of logging |

---

### Conference

#### Get conference health

```ts
const health = await api.conference.getHealth();
```

Returns the health status of the IServ video conference endpoint.

---

## Logging

The SDK logs to stderr using a built-in logger. Set `ISERV_DEBUG=1` to enable debug output.
Logger output is redacted (no hostnames, cookies, tokens, or account identifiers):

```bash
ISERV_DEBUG=1 node app.js
```

Useful environment variables: `ISERV_TIMEOUT_MS` (default `30000`), `ISERV_USER_AGENT`,
`ISERV_DEBUG`, and `ISERV_LIVE=1` for the opt-in live suite.

---

## License

MIT

> **Disclaimer:** This is an unofficial SDK not affiliated with IServ GmbH. Use at your own risk. The authors are not responsible for any damages or data loss caused by use of this package.
