import { describe, expect, it } from "vitest";

import { createFixtureRootFs, resolveWithinRoot } from "../src/root-fs.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

describe("fixture root fs", () => {
  it("resolves paths within the fixture root and blocks escapes", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-root-fs-"
    });
    const rootFs = createFixtureRootFs(root.rootPath);

    expect(resolveWithinRoot(root.rootPath, "notes/readme.txt")).toBe(root.resolve("notes/readme.txt"));
    expect(resolveWithinRoot(root.rootPath, "../package.json")).toBeNull();
    expect(rootFs.resolve("notes/readme.txt")).toBe(root.resolve("notes/readme.txt"));
    expect(rootFs.resolve("../package.json")).toBeNull();
    await expect(rootFs.writeText("../escape.txt", "nope")).rejects.toThrow(
      'Path "../escape.txt" must stay within the fixture root.'
    );
  });

  it("reads, writes, and lists files relative to the root", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-root-fs-"
    });
    const rootFs = createFixtureRootFs(root.rootPath);

    await rootFs.writeText("notes/readme.txt", "hello");
    await rootFs.writeJson("data/value.json", { ok: true });

    expect(await rootFs.exists("notes/readme.txt")).toBe(true);
    expect(await rootFs.exists("../escape.txt")).toBe(false);
    expect(await rootFs.readText("notes/readme.txt")).toBe("hello");
    expect(await rootFs.readJson<{ ok: boolean }>("data/value.json")).toEqual({ ok: true });
    expect(await rootFs.readOptionalJson("missing.json")).toBeNull();
    expect(await rootFs.readOptionalText("missing.txt")).toBeNull();
    expect(await rootFs.stat("notes/readme.txt")).toEqual(expect.objectContaining({ isFile: expect.any(Function) }));
    expect(await rootFs.listDirectory("")).toEqual(expect.arrayContaining([
      { name: ".wraithwalker", kind: "directory" },
      { name: "data", kind: "directory" },
      { name: "notes", kind: "directory" }
    ]));
    expect(await rootFs.listDirectories("")).toEqual(expect.arrayContaining([".wraithwalker", "data", "notes"]));
  });

  it("copies and removes directory trees within the root", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-root-fs-"
    });
    const rootFs = createFixtureRootFs(root.rootPath);

    await rootFs.writeText("fixtures/app.js", "console.log('v1');");
    await rootFs.writeText("fixtures/nested/data.json", "{\"ok\":true}");

    await rootFs.copyRecursive("fixtures", ".wraithwalker/scenarios/baseline/fixtures");

    expect(await rootFs.readText(".wraithwalker/scenarios/baseline/fixtures/app.js")).toBe("console.log('v1');");
    expect(await rootFs.readJson<{ ok: boolean }>(".wraithwalker/scenarios/baseline/fixtures/nested/data.json")).toEqual({ ok: true });

    await rootFs.remove("fixtures", { recursive: true, force: true });
    expect(await rootFs.exists("fixtures/app.js")).toBe(false);
  });
});
