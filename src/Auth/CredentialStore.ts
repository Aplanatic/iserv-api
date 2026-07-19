import { Entry } from "@napi-rs/keyring";

export interface CredentialStore {
  get(profile: string): Promise<string | null>;
  set(profile: string, value: string): Promise<void>;
  delete(profile: string): Promise<void>;
}

export class NativeCredentialStore implements CredentialStore {
  constructor(private readonly service = "dev.aplanatic.iserv") {}

  private entry(profile: string): Entry {
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(profile)) throw new Error("Invalid profile name");
    return new Entry(this.service, profile);
  }

  async get(profile: string): Promise<string | null> {
    try {
      return this.entry(profile).getPassword();
    } catch (error) {
      if (error instanceof Error && /not found|no entry/i.test(error.message)) return null;
      throw new Error(
        `Native credential store is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async set(profile: string, value: string): Promise<void> {
    try {
      this.entry(profile).setPassword(value);
    } catch (error) {
      throw new Error(
        `Native credential store is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async delete(profile: string): Promise<void> {
    try {
      this.entry(profile).deletePassword();
    } catch (error) {
      if (!(error instanceof Error) || !/not found|no entry/i.test(error.message)) {
        throw new Error(
          `Native credential store is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
