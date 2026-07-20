import type { WebDAVClient } from "webdav";
import { createClient } from "webdav";
import { IServApiError } from "../Core/Errors.js";
import { parseIServJsonData } from "../Core/HttpClient.js";
import type { IServSession } from "../Core/IServSession.js";
import { createLogger } from "../Core/Logger.js";
import type { DiskSpaceEntry, FolderSize, GetWebDavClientOptions } from "./FilesTypes.js";

const log = createLogger("Files");

function validateFolderPath(folderPath: string): void {
  if (folderPath.includes("\0") || folderPath.split(/[\\/]/).some((seg) => seg === "..")) {
    throw new IServApiError(`Invalid folder path: "${folderPath}"`, 400);
  }
}

export class FilesService {
  constructor(private readonly session: IServSession) {}

  getClient(options: GetWebDavClientOptions = {}): WebDAVClient {
    const davUrl = options.davUrl ?? `webdav.${this.session.url}`;

    if (options.davUrl && !options.davUrl.endsWith(`.${this.session.url}`)) {
      throw new IServApiError(`davUrl must be a subdomain of "${this.session.url}"`, 400);
    }

    const username = options.username ?? this.session.username;
    const password = options.password ?? this.session.getPassword();

    const client = createClient(`https://${davUrl}`, { username, password });
    log.info("WebDAV client created");
    return client;
  }

  async getFolderSize(folderPath: string): Promise<FolderSize> {
    if (!folderPath || !folderPath.trim()) {
      throw new IServApiError("Folder path is required (e.g. / or /Files).", 400);
    }
    validateFolderPath(folderPath);
    const res = await this.session.http.get(`${this.session.baseUrl()}/iserv/file/calc`, {
      params: { path: folderPath },
    });
    return parseIServJsonData<FolderSize>(res.data, "folder size");
  }

  async getDiskSpace(): Promise<DiskSpaceEntry[]> {
    const res = await this.session.http.get(`${this.session.baseUrl()}/iserv/du/account`);
    const match = (res.data as string).match(/id="user-diskusage-data"[^>]*>([^<]+)</);
    if (!match?.[1]) {
      throw new IServApiError("Could not retrieve disk usage data", 500);
    }

    try {
      return JSON.parse(match[1].trim().replace(/^\(|\)$/g, "")) as DiskSpaceEntry[];
    } catch (err) {
      throw new IServApiError(
        `Could not parse disk usage data: ${err instanceof Error ? err.message : "invalid JSON"}`,
        500,
      );
    }
  }
}
