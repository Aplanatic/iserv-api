const SECRET_KEY = /authorization|cookie|password|passwd|secret|token|session/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HOST = /\b(?:[a-z0-9-]+\.)+(?:de|com|org|net|edu|eu|app|dev|school|cloud|info)\b/gi;
const ROUTE_ID = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/;

export function redactText(value: string): string {
  return value.replace(EMAIL, "[redacted-email]").replace(HOST, (host) => {
    if (host === "iserv.example" || host.endsWith(".invalid")) return host;
    return "[redacted-host]";
  });
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SECRET_KEY.test(key)
          ? "[redacted]"
          : key === "routeId" && typeof entry === "string" && ROUTE_ID.test(entry)
            ? entry
            : redactValue(entry, depth + 1),
      ]),
    );
  }
  return value;
}
