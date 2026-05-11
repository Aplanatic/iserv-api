# Changelog

## 1.3.1 - 2026-05-11

### Changed

- Replaced `date-fns` with `dayjs` for calendar date formatting to reduce the package dependency size.

## 1.3.0 - 2026-05-11

### Added

- Added support for sending Messenger messages with `api.messenger.sendMessage(roomId, body)` and `api.messenger.sendMessageByName(name, body)`.
