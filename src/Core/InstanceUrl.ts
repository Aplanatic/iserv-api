export interface NormalizedInstance {
  origin: string;
  hostname: string;
}

function isPrivateHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "::1" || hostname.endsWith(".local")) return true;
  if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname))
    return true;
  const match = hostname.match(/^172\.(\d+)\./);
  return match ? Number(match[1]) >= 16 && Number(match[1]) <= 31 : false;
}

export function normalizeInstanceUrl(
  input: string,
  options: { allowPrivateHost?: boolean } = {},
): NormalizedInstance {
  const raw = input.trim();
  if (!raw) throw new Error("IServ instance URL is required");
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(candidate);
  if (url.protocol !== "https:") throw new Error("IServ instances must use HTTPS");
  if (url.username || url.password) throw new Error("Credentials must not be embedded in the URL");
  if (url.search || url.hash) throw new Error("Instance URLs must not contain a query or fragment");
  if (url.port && url.port !== "443") throw new Error("Only the standard HTTPS port is allowed");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/" && path !== "/iserv") {
    throw new Error("Instance URL path must be / or /iserv");
  }
  const hostname = url.hostname.toLowerCase();
  if (!options.allowPrivateHost && isPrivateHostname(hostname)) {
    throw new Error("Private network instances require allowPrivateHost");
  }
  return { origin: `https://${hostname}`, hostname };
}

export function assertSameOrigin(expectedOrigin: string, actualUrl: string): void {
  if (new URL(actualUrl).origin !== expectedOrigin) {
    throw new Error("Cross-origin redirects are not allowed during authentication");
  }
}
