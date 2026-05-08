import { describe, expect, test } from "vitest";
import { ConferenceService } from "../src/Conference/ConferenceService.js";
import { createMockIServSession } from "./helpers/mockIServSession.js";

describe("ConferenceService", () => {
  test("getHealth calls IServ's conference health endpoint and parses the raw JSON object", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/videoconference/api/health",
          response: {
            data: JSON.stringify({
              load: 0.1,
              normalizedLoad: 1,
              loadClassification: "green",
              loadDescription: "Geringe Auslastung",
              counter: { meetings: 0, participants: 0, threads: 512 },
            }),
          },
        },
      ],
    });

    await expect(new ConferenceService(session).getHealth()).resolves.toEqual({
      load: 0.1,
      normalizedLoad: 1,
      loadClassification: "green",
      loadDescription: "Geringe Auslastung",
      counter: { meetings: 0, participants: 0, threads: 512 },
    });
    expectAllRoutesCalled();
  });
});
