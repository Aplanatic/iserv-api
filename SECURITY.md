# Security policy

## Supported versions

Security fixes are applied to the latest release and `main`. Older releases should be
upgraded before a report is reproduced.

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/Aplanatic/iserv-api/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

Never include a real IServ hostname, username, email address, school name, screenshot,
HAR file, cookie, session, token, password, message, file, or unredacted response. A minimal
reproduction must use `iserv.example`, synthetic identities, and mocked payloads.

Useful reports describe the affected version, security boundary, sanitized reproduction,
impact, and a proposed mitigation. Reports must not rely on accessing accounts, instances,
or routes without authorization.

## Security boundaries

- Authentication must stay on the user-selected HTTPS instance unless the isolated browser
  flow is explicitly used; stored cookies are scoped back to that instance.
- Normal-user access is not a mechanism for bypassing permissions or probing admin routes.
- Credentials, sessions, and scoped tokens use the native operating-system credential
  store only; there is no file fallback. Ephemeral login may omit the password from the
  keychain while still storing scoped session cookies.
- Instance hostnames must be real DNS names (path-like and single-label values are rejected).
- The explorer is loopback-only, token-protected, GET-only, and restricted to catalogued
  read routes.
- Logs, traces, fixtures, issues, tests, and release assets must contain only synthetic or
  redacted data.

## Safe research

Use an instance and account you own or have explicit permission to test. Do not send
messages or email, alter records, upload files, join or leave rooms, or run destructive
operations while researching a read-path problem unless the owner explicitly approved it.
