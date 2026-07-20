import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ProfileStore } from "../src/Auth/ProfileStore.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("ProfileStore", () => {
  test("atomically creates, selects, and removes non-secret profiles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "iserv-profiles-"));
    directories.push(directory);
    const store = new ProfileStore(directory);

    await store.upsert({ name: "school", hostname: "iserv.example", username: "test.user" });
    expect((await store.read()).activeProfile).toBe("school");
    expect(await readFile(store.path, "utf8")).not.toContain("password");

    await store.upsert({ name: "second", hostname: "iserv.example", username: "second.user" });
    await store.setActive("school");
    expect((await store.read()).activeProfile).toBe("school");

    await store.remove("school");
    expect((await store.read()).activeProfile).toBe("second");
    expect(await readFile(`${store.path}.bak`, "utf8")).toContain("school");
  });

  test("serializes concurrent writers with a lockfile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "iserv-profiles-"));
    directories.push(directory);
    const store = new ProfileStore(directory);
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.upsert({
          name: `p${index}`,
          hostname: "iserv.example",
          username: `user${index}`,
        }),
      ),
    );
    expect((await store.read()).profiles).toHaveLength(8);
  });

  test("rejects unknown active profiles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "iserv-profiles-"));
    directories.push(directory);
    await expect(new ProfileStore(directory).setActive("missing")).rejects.toThrow(
      /Unknown profile/,
    );
  });
});
