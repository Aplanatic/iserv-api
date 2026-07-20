import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import type { Cookie } from "playwright-core";
import { CookieJar } from "tough-cookie";
import { normalizeInstanceUrl } from "../Core/InstanceUrl.js";
import type { StoredSession } from "../Core/IServClient.js";

async function browserExecutable(): Promise<string> {
  const candidates = [
    process.env.ISERV_BROWSER_PATH,
    platform() === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined,
    platform() === "darwin"
      ? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      : undefined,
    platform() === "win32"
      ? join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe")
      : undefined,
    platform() === "linux" ? "/usr/bin/google-chrome" : undefined,
    platform() === "linux" ? "/usr/bin/chromium" : undefined,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through known browser locations.
    }
  }
  throw new Error(
    "No supported browser found; set ISERV_BROWSER_PATH to Chrome, Chromium, or Edge",
  );
}

function toStoredCookies(cookies: Cookie[], origin: string) {
  const jar = new CookieJar();
  for (const cookie of cookies) {
    const attributes = [
      `${cookie.name}=${cookie.value}`,
      `Path=${cookie.path}`,
      cookie.domain ? `Domain=${cookie.domain}` : "",
      cookie.secure ? "Secure" : "",
      cookie.httpOnly ? "HttpOnly" : "",
    ].filter(Boolean);
    jar.setCookieSync(attributes.join("; "), origin);
  }
  const serialized = jar.serializeSync();
  if (!serialized) throw new Error("Unable to serialize browser session cookies");
  return serialized;
}

export async function loginWithBrowser(options: {
  url: string;
  username: string;
  timeoutMs?: number;
  allowPrivateHost?: boolean;
}): Promise<StoredSession> {
  const { chromium } = await import("playwright-core");
  const instance = normalizeInstanceUrl(
    options.url,
    options.allowPrivateHost ? { allowPrivateHost: true } : {},
  );
  const browser = await chromium.launch({
    headless: false,
    executablePath: await browserExecutable(),
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${instance.origin}/iserv/`, { waitUntil: "domcontentloaded" });
    const deadline = Date.now() + (options.timeoutMs ?? 180_000);
    while (Date.now() < deadline) {
      const cookies = await context.cookies(instance.origin);
      if (cookies.some((cookie) => /^IServ(?:Session|SAT|SATId)$/i.test(cookie.name))) {
        return {
          hostname: instance.hostname,
          username: options.username,
          cookies: toStoredCookies(cookies, instance.origin),
        };
      }
      await page.waitForTimeout(500);
    }
    throw new Error("Browser login timed out before an IServ session was created");
  } finally {
    await browser.close();
  }
}
