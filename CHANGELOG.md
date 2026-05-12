# Changelog

## 1.3.2 - 2026-05-12

### Added

- Added `api.email.markAsUnread(uid, mailbox?)` to mark an email as unread.
- Added `api.email.markAsRead(uid, mailbox?)` to mark an email as read.

## 1.3.1 - 2026-05-11

### Changed

- Replaced `date-fns` with `dayjs` for calendar date formatting to reduce the package dependency size.

## 1.3.0 - 2026-05-11

### Added

- Added support for sending Messenger messages with `api.messenger.sendMessage(roomId, body)` and `api.messenger.sendMessageByName(name, body)`.
