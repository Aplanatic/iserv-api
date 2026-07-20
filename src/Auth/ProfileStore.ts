import { copyFile, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
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

export function resolveConfigDirectory(): string {
  if (process.env.ISERV_CONFIG_DIR) return process.env.ISERV_CONFIG_DIR;
  if (process.env.ISERV_PORTABLE === "1") return join(process.cwd(), ".iserv");
  if (platform() === "win32") return join(process.env.APPDATA ?? homedir(), "Aplanatic", "IServ");
  if (platform() === "darwin")
    return join(homedir(), "Library", "Application Support", "Aplanatic", "IServ");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "aplanatic-iserv");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exclusive lockfile around profiles.json mutations (multi-process safe). */
async function withProfilesLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, "profiles.json.lock");
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
      await handle.close();
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      if (Date.now() > deadline) {
        throw new Error("profiles.json is locked by another iserv process. Retry in a moment.");
      }
      await sleep(40);
    }
  }
  try {
    return await action();
  } finally {
    await unlink(lockPath).catch(() => undefined);
  }
}

export class ProfileStore {
  readonly directory: string;
  readonly path: string;
  constructor(directory = resolveConfigDirectory()) {
    this.directory = directory;
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

  private async backup(): Promise<string | undefined> {
    try {
      await readFile(this.path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
    const backupPath = `${this.path}.bak`;
    await copyFile(this.path, backupPath);
    return backupPath;
  }

  async upsert(profile: Omit<ProfileMetadata, "createdAt" | "updatedAt">): Promise<void> {
    await withProfilesLock(this.directory, async () => {
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
    });
  }

  async setActive(name: string): Promise<void> {
    await withProfilesLock(this.directory, async () => {
      const document = await this.read();
      if (!document.profiles.some((profile) => profile.name === name))
        throw new Error(`Unknown profile: ${name}`);
      document.activeProfile = name;
      await this.write(document);
    });
  }

  async remove(name: string): Promise<{ backupPath?: string }> {
    return withProfilesLock(this.directory, async () => {
      const backupPath = await this.backup();
      const document = await this.read();
      document.profiles = document.profiles.filter((profile) => profile.name !== name);
      if (document.activeProfile === name)
        document.activeProfile = document.profiles[0]?.name ?? null;
      await this.write(document);
      return backupPath ? { backupPath } : {};
    });
  }
}
