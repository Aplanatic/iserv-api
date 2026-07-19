import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export interface ProfileMetadata {
  name: string;
  hostname: string;
  username: string;
  createdAt: string;
  updatedAt: string;
}

interface ProfileDocument {
  version: 1;
  activeProfile: string | null;
  profiles: ProfileMetadata[];
}

function defaultConfigDirectory(): string {
  if (process.env.ISERV_CONFIG_DIR) return process.env.ISERV_CONFIG_DIR;
  if (platform() === "win32") return join(process.env.APPDATA ?? homedir(), "Aplanatic", "IServ");
  if (platform() === "darwin")
    return join(homedir(), "Library", "Application Support", "Aplanatic", "IServ");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "aplanatic-iserv");
}

export class ProfileStore {
  readonly path: string;
  constructor(directory = defaultConfigDirectory()) {
    this.path = join(directory, "profiles.json");
  }

  async read(): Promise<ProfileDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as ProfileDocument;
      if (parsed.version !== 1 || !Array.isArray(parsed.profiles))
        throw new Error("unsupported profile document");
      return parsed;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { version: 1, activeProfile: null, profiles: [] };
      }
      throw new Error(
        `Unable to read IServ profiles: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async write(document: ProfileDocument): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }

  async upsert(profile: Omit<ProfileMetadata, "createdAt" | "updatedAt">): Promise<void> {
    const document = await this.read();
    const now = new Date().toISOString();
    const existing = document.profiles.find((item) => item.name === profile.name);
    const next: ProfileMetadata = {
      ...profile,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    document.profiles = [
      ...document.profiles.filter((item) => item.name !== profile.name),
      next,
    ].sort((a, b) => a.name.localeCompare(b.name));
    document.activeProfile = profile.name;
    await this.write(document);
  }

  async setActive(name: string): Promise<void> {
    const document = await this.read();
    if (!document.profiles.some((profile) => profile.name === name))
      throw new Error(`Unknown profile: ${name}`);
    document.activeProfile = name;
    await this.write(document);
  }

  async remove(name: string): Promise<void> {
    const document = await this.read();
    document.profiles = document.profiles.filter((profile) => profile.name !== name);
    if (document.activeProfile === name)
      document.activeProfile = document.profiles[0]?.name ?? null;
    await this.write(document);
  }
}
