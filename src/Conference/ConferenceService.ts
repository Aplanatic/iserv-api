import { parseJson } from "../Core/HttpClient.js";
import type { IServSession } from "../Core/IServSession.js";
import { createLogger } from "../Core/Logger.js";
import type { ConferenceHealth } from "./ConferenceTypes.js";

const log = createLogger("Conference");

export class ConferenceService {
  constructor(private readonly session: IServSession) {}

  async getHealth(): Promise<ConferenceHealth> {
    const res = await this.session.http.get(
      `${this.session.baseUrl()}/iserv/videoconference/api/health`,
    );
    log.info("Got conference health");
    return parseJson<ConferenceHealth>(res.data, "conference health");
  }
}
