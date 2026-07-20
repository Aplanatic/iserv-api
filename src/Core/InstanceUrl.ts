import { isIP } from "node:net";

export interface NormalizedInstance {
  origin: string;
  hostname: string;
}

function isPrivateHostname(hostname: string): boolean {
  const address = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (address === "localhost" || address.endsWith(".localhost") || address.endsWith(".local")) {
    return true;
  }
  if (isIP(address) === 4) {
    const [first = 0, second = 0] = address.split(".").map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 0 || second === 168)) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }
  if (isIP(address) === 6) {
    const first = Number.parseInt(address.split(":", 1)[0] ?? "0", 16);
    return (
      address === "::" ||
      address === "::1" ||
      address.startsWith("::ffff:") ||
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xff00) === 0xff00 ||
      address.startsWith("2001:db8:")
    );
  }
  return false;
}

function isPlausibleHostname(hostname: string, allowPrivateHost: boolean): boolean {
  if (!hostname || hostname.includes("..") || hostname.includes("/") || hostname.includes("\\")) {
    return false;
  }
  const address = hostname.replace(/^\[|\]$/g, "");
  if (isIP(address) !== 0) return true;
  // Public instances must look like a DNS name with a TLD (e.g. school.example).
  if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)) {
    return true;
  }
  // Single-label hosts only when private hosts are explicitly allowed (LAN).
  return allowPrivateHost && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname);
}

export function normalizeInstanceUrl(
  input: string,
  options: { allowPrivateHost?: boolean } = {},
): NormalizedInstance {
  const raw = input.trim();
  if (!raw) throw new Error("IServ instance URL is required");
  if (/[\\/]/.test(raw.replace(/^https?:\/\//i, "").split("/")[0] ?? "")) {
    throw new Error("Invalid IServ hostname");
  }
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Invalid IServ instance URL");
  }
  if (url.protocol !== "https:") throw new Error("IServ instances must use HTTPS");
  if (url.username || url.password) throw new Error("Credentials must not be embedded in the URL");
  if (url.search || url.hash) throw new Error("Instance URLs must not contain a query or fragment");
  if (url.port && url.port !== "443") throw new Error("Only the standard HTTPS port is allowed");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/" && path !== "/iserv") {
    throw new Error("Instance URL path must be / or /iserv");
  }
  const hostname = url.hostname.toLowerCase();
  if (!isPlausibleHostname(hostname, Boolean(options.allowPrivateHost))) {
    throw new Error("Invalid IServ hostname");
  }
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
