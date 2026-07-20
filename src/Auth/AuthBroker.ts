import { CapabilityService, type ModuleCapability } from "../Capabilities/CapabilityService.js";
import { normalizeInstanceUrl } from "../Core/InstanceUrl.js";
import { IServAPI, type StoredSession } from "../Core/IServClient.js";
import type { AuthChallengeHandler } from "./AuthService.js";
import { loginWithBrowser } from "./BrowserAuth.js";
import { type CredentialStore, NativeCredentialStore } from "./CredentialStore.js";
import { ProfileStore } from "./ProfileStore.js";

export interface LoginOptions {
  profile: string;
  url: string;
  username: string;
  password: string;
  challengeHandler?: AuthChallengeHandler;
  allowPrivateHost?: boolean;
}

export interface BrowserLoginOptions {
  profile: string;
  url: string;
  username: string;
  timeoutMs?: number;
  allowPrivateHost?: boolean;
}

export interface AuthStatus {
  profile: string | null;
  configured: boolean;
  authenticated: boolean;
  account?: { username: string; displayName?: string };
  capabilities?: ModuleCapability[];
  capabilitiesVerified?: boolean;
}

export class AuthBroker {
  constructor(
    readonly profiles = new ProfileStore(),
    readonly credentials: CredentialStore = new NativeCredentialStore(),
  ) {}

  private async restoreStored(name: string, encoded: string): Promise<IServAPI> {
    const stored = JSON.parse(encoded) as StoredSession;
    const client = IServAPI.restore(stored);
    if (stored.password !== undefined) {
      await this.credentials.set(name, JSON.stringify(client.exportSession()));
    }
    return client;
  }

  async login(options: LoginOptions): Promise<IServAPI> {
    const instance = normalizeInstanceUrl(
      options.url,
      options.allowPrivateHost ? { allowPrivateHost: true } : {},
    );
    const client = await IServAPI.connect(
      instance.hostname,
      options.username,
      options.password,
      options.challengeHandler ? { challengeHandler: options.challengeHandler } : {},
    );
    await this.credentials.set(options.profile, JSON.stringify(client.exportSession()));
    await this.profiles.upsert({
      name: options.profile,
      hostname: instance.hostname,
      username: options.username,
    });
    return client;
  }

  async restore(profile?: string): Promise<IServAPI> {
    const document = await this.profiles.read();
    const name = profile ?? document.activeProfile;
    if (!name) throw new Error("No active IServ profile; run the login command first");
    const encoded = await this.credentials.get(name);
    if (!encoded) throw new Error(`No native-keychain session exists for profile: ${name}`);
    return this.restoreStored(name, encoded);
  }

  async restoreMessenger(profile?: string): Promise<IServAPI> {
    const document = await this.profiles.read();
    const name = profile ?? document.activeProfile;
    if (!name) throw new Error("No active IServ profile; run the login command first");
    const client = await this.restore(name);
    await client.ensureMessengerSession();
    await this.credentials.set(name, JSON.stringify(client.exportSession()));
    return client;
  }

  async loginBrowser(options: BrowserLoginOptions): Promise<IServAPI> {
    const stored = await loginWithBrowser(options);
    await this.credentials.set(options.profile, JSON.stringify(stored));
    await this.profiles.upsert({
      name: options.profile,
      hostname: stored.hostname,
      username: options.username,
    });
    return IServAPI.restore(stored);
  }

  async status(profile?: string): Promise<AuthStatus> {
    const document = await this.profiles.read();
    const name = profile ?? document.activeProfile;
    if (!name) return { profile: null, configured: false, authenticated: false };
    const metadata = document.profiles.find((candidate) => candidate.name === name);
    const configured = Boolean(metadata);
    const encoded = await this.credentials.get(name);
    const account = metadata ? { username: metadata.username } : undefined;
    if (!encoded)
      return { profile: name, configured, authenticated: false, ...(account ? { account } : {}) };
    try {
      const client = await this.restoreStored(name, encoded);
      const [infoResult, capabilitiesResult] = await Promise.allSettled([
        client.users.getOwnInfo(),
        client.capabilities.list(),
      ]);
      if (infoResult.status === "rejected") throw infoResult.reason;
      const capabilityResult =
        capabilitiesResult.status === "fulfilled"
          ? { capabilities: capabilitiesResult.value, verified: true }
          : { capabilities: CapabilityService.unknown(), verified: false };
      return {
        profile: name,
        configured,
        authenticated: true,
        account: {
          username: metadata?.username ?? "",
          displayName: infoResult.value.name,
        },
        capabilities: capabilityResult.capabilities,
        capabilitiesVerified: capabilityResult.verified,
      };
    } catch {
      return { profile: name, configured, authenticated: false, ...(account ? { account } : {}) };
    }
  }

  async logout(profile?: string): Promise<void> {
    const document = await this.profiles.read();
    const name = profile ?? document.activeProfile;
    if (!name) return;
    try {
      const client = await this.restore(name);
      await client.disconnect();
    } finally {
      await this.credentials.delete(name);
    }
  }
}
