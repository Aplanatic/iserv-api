import { afterEach, describe, expect, test, vi } from "vitest";
import { AuthBroker } from "../src/Auth/AuthBroker.js";
import type { CredentialStore } from "../src/Auth/CredentialStore.js";
import type { ProfileStore } from "../src/Auth/ProfileStore.js";
import { IServAPI } from "../src/Core/IServClient.js";

const profiles = {
  read: async () => ({
    version: 1 as const,
    activeProfile: "default",
    profiles: [
      {
        name: "default",
        hostname: "iserv.example",
        username: "alice",
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z",
      },
    ],
  }),
} as ProfileStore;

const credentials = {
  get: async () => JSON.stringify({ hostname: "iserv.example" }),
  set: async () => undefined,
  delete: async () => undefined,
} satisfies CredentialStore;

describe("AuthBroker status", () => {
  afterEach(() => vi.restoreAllMocks());

  test("keeps a verified identity when capability discovery is temporarily unavailable", async () => {
    vi.spyOn(IServAPI, "restore").mockReturnValue({
      users: { getOwnInfo: async () => ({ name: "Example Student" }) },
      capabilities: { list: async () => Promise.reject(new Error("temporary failure")) },
    } as unknown as IServAPI);

    const status = await new AuthBroker(profiles, credentials).status();

    expect(status).toMatchObject({
      authenticated: true,
      account: { username: "alice", displayName: "Example Student" },
      capabilitiesVerified: false,
    });
    expect(status.capabilities?.every((item) => item.access === "unknown")).toBe(true);
  });

  test("checks identity and capabilities concurrently", async () => {
    let releaseIdentity: (() => void) | undefined;
    const identity = new Promise<{ name: string }>((resolve) => {
      releaseIdentity = () => resolve({ name: "Example Student" });
    });
    const capabilities = vi.fn(async () => []);
    vi.spyOn(IServAPI, "restore").mockReturnValue({
      users: { getOwnInfo: async () => identity },
      capabilities: { list: capabilities },
    } as unknown as IServAPI);

    const pending = new AuthBroker(profiles, credentials).status();
    await vi.waitFor(() => expect(capabilities).toHaveBeenCalledOnce());
    releaseIdentity?.();

    await expect(pending).resolves.toMatchObject({
      authenticated: true,
      capabilitiesVerified: true,
    });
  });
});

describe("AuthBroker credential minimization", () => {
  afterEach(() => vi.restoreAllMocks());

  test("removes legacy persisted passwords when a session is restored", async () => {
    const writes: string[] = [];
    const legacyCredentials = {
      get: async () =>
        JSON.stringify({
          hostname: "iserv.example",
          username: "alice",
          password: "test-password",
          cookies: {
            version: "tough-cookie@6.0.0",
            storeType: "MemoryCookieStore",
            rejectPublicSuffixes: true,
            enableLooseMode: false,
            allowSpecialUseDomain: true,
            prefixSecurity: "silent",
            cookies: [],
          },
        }),
      set: async (_profile: string, value: string) => writes.push(value),
      delete: async () => undefined,
    } satisfies CredentialStore;

    await new AuthBroker(profiles, legacyCredentials).restore();

    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] ?? "{}")).not.toHaveProperty("password");
  });
});
