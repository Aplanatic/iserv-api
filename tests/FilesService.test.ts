import { describe, expect, test } from "vitest";
import { FilesService } from "../src/Files/FilesService.js";
import { createMockIServSession, iservJson } from "./helpers/mockIServSession.js";

describe("FilesService", () => {
  test("getFolderSize mirrors the IServ file/calc GET route with a path query", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/file/calc",
          params: { path: "/Files" },
          response: { data: iservJson({ size: "2.522.285 KB" }) },
        },
      ],
    });

    await expect(new FilesService(session).getFolderSize("/Files")).resolves.toEqual({
      size: "2.522.285 KB",
    });
    expectAllRoutesCalled();
  });

  test("getDiskSpace parses IServ's embedded disk usage script payload", async () => {
    const { session, expectAllRoutesCalled } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/du/account",
          response: {
            data: `
              <html>
                <body>
                  <script id="user-diskusage-data" type="application/json">
                    ([{"label":"Dateien","size":"2582819453","color":"#F6D26F","sizeHuman":"2,463 MB"}])
                  </script>
                </body>
              </html>
            `,
          },
        },
      ],
    });

    await expect(new FilesService(session).getDiskSpace()).resolves.toEqual([
      {
        label: "Dateien",
        size: "2582819453",
        color: "#F6D26F",
        sizeHuman: "2,463 MB",
      },
    ]);
    expectAllRoutesCalled();
  });

  test("getDiskSpace throws instead of returning raw HTML when the payload is missing", async () => {
    const { session } = createMockIServSession({
      routes: [
        {
          method: "get",
          url: "https://iserv.example/iserv/du/account",
          response: { data: "<html><body>No disk usage script</body></html>" },
        },
      ],
    });

    await expect(new FilesService(session).getDiskSpace()).rejects.toThrow("disk usage");
  });
});
