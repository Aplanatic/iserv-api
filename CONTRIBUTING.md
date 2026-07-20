# Contributing

Contributions are welcome when they preserve the normal-user, least-privilege scope.

## Privacy first

- Use only `iserv.example`, `example.invalid`, and synthetic people or payloads.
- Never commit or post credentials, hostnames, school details, screenshots, HAR files,
  cookies, tokens, live HTML, messages, email, user lists, file contents, or response dumps.
- Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md).
- Do not add admin-route probing, arbitrary HTTP, TLS bypasses, plaintext credential
  storage, or permission-bypass behavior.

## Route changes

Every route needs a stable ID, authentication method, side-effect classification,
capability, parameters, provenance, implementation state, and verification metadata.
Prefer a structured loader (`ModulePageService`, `TimetableService`, and similar) when the
page has stable content; otherwise fall through to `HtmlExtractedData` via `summarizeHtml`.
Add a mocked contract test. Live checks are local-only, opt-in, bounded, and read-only;
they must never print response data or identifiers.

## Checks

Run:

```sh
npm ci
npm ci --prefix explorer
npm run check
npm audit --audit-level=low
npm audit --prefix explorer --audit-level=low
gitleaks git --redact=100 --log-opts=--all .
```

Keep changes focused and update the README, route catalog, and changelog when behavior or
coverage changes.
