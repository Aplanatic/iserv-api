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

export class AuthBroker {
  constructor(
    readonly profiles = new ProfileStore(),
    readonly credentials: CredentialStore = new NativeCredentialStore(),
  ) {}

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
    await this.credentials.set(
      options.profile,
      JSON.stringify(client.exportSession({ includePassword: true })),
    );
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
    const stored = JSON.parse(encoded) as StoredSession;
    return IServAPI.restore(stored);
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

  async status(
    profile?: string,
  ): Promise<{ profile: string | null; configured: boolean; authenticated: boolean }> {
    const document = await this.profiles.read();
    const name = profile ?? document.activeProfile;
    if (!name) return { profile: null, configured: false, authenticated: false };
    const configured = document.profiles.some((candidate) => candidate.name === name);
    const encoded = await this.credentials.get(name);
    if (!encoded) return { profile: name, configured, authenticated: false };
    return {
      profile: name,
      configured,
      authenticated: await IServAPI.restore(JSON.parse(encoded) as StoredSession).validateSession(),
    };
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
