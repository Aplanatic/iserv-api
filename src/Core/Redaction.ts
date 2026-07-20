const SECRET_KEY = /authorization|cookie|password|passwd|secret|token|session|keychain|credential/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HOST = /\b(?:[a-z0-9-]+\.)+(?:de|com|org|net|edu|eu|app|dev|school|cloud|info)\b/gi;
const ROUTE_ID = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/;

// Keys that are safe to keep (internal metadata, structural fields)
const SAFE_KEY =
  /^(kind|routeId|status|durationMs|_summary|_csrf_present|_nav_items|_active_nav|_user|bytes|title|caption|heading|headers|action|method|fields|level|text|href|label|items|content|module|sideEffect|authentication|capability|summary|description|path|provenance|reference|lastVerified|compatibility|name|username|displayName|access|catalogued|verifiedReadRoutes)$/i;

export function redactText(value: string): string {
  return value.replace(EMAIL, "[redacted-email]").replace(HOST, (host) => {
    if (host === "iserv.example" || host.includes(".invalid")) return host;
    return "[redacted-host]";
  });
}

export function redactValue(value: unknown, depth = 0, opts?: { maxArrayItems?: number }): unknown {
  // Match the highest intentional list limit (mail API allows up to 1000)
  const maxArrayItems = opts?.maxArrayItems ?? 1000;
  if (depth > 16) return "[truncated]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) {
    const sliced = value.slice(0, maxArrayItems);
    return sliced.map((item) => redactValue(item, depth + 1, opts));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        // Secret keys: always redact
        if (SECRET_KEY.test(key)) return [key, "[redacted]"];
        // Route IDs: preserve as-is
        if (key === "routeId" && typeof entry === "string" && ROUTE_ID.test(entry)) {
          return [key, entry];
        }
        // Structural/display metadata keys: skip redaction
        if (SAFE_KEY.test(key)) {
          return [key, redactValue(entry, depth + 1, opts)];
        }
        // Skip redaction for known safe path
        if (key === "provenance" || key === "pagination") {
          return [key, entry];
        }
        return [key, redactValue(entry, depth + 1, opts)];
      }),
    );
  }
  return value;
}
