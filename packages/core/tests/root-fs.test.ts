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
    expect(resolveWithinRoot(root.rootPath, "/tmp/outside.txt")).toBeNull();
    expect(rootFs.resolve("notes/readme.txt")).toBe(root.resolve("notes/readme.txt"));
    expect(rootFs.resolve("../package.json")).toBeNull();
    expect(rootFs.resolve("/tmp/outside.txt")).toBeNull();
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
    expect(await rootFs.stat("../escape.txt")).toBeNull();
    expect(await rootFs.listDirectory("")).toEqual(expect.arrayContaining([
      { name: ".wraithwalker", kind: "directory" },
      { name: "data", kind: "directory" },
      { name: "notes", kind: "directory" }
    ]));
    expect(await rootFs.listDirectories("")).toEqual(expect.arrayContaining([".wraithwalker", "data", "notes"]));
    expect(await rootFs.listOptionalDirectory("missing-directory")).toEqual([]);
    expect(await rootFs.listOptionalDirectories("missing-directory")).toEqual([]);
  });

  it("writes utf8 and base64 bodies with progress updates", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-root-fs-"
    });
    const rootFs = createFixtureRootFs(root.rootPath);
    const progress: Array<[number, number]> = [];

    await rootFs.writeBody(
      "binary/font.woff2",
      {
        body: Buffer.from([0, 1, 2, 3, 4, 5]).toString("base64"),
        bodyEncoding: "base64"
      },
      {
        chunkSize: 2,
        onProgress(writtenBytes, totalBytes) {
          progress.push([writtenBytes, totalBytes]);
        }
      }
    );
    await rootFs.writeBody("text/readme.txt", { body: "hello", bodyEncoding: "utf8" });

    expect(await rootFs.readText("text/readme.txt")).toBe("hello");
    expect(await rootFs.readBodyAsBase64("binary/font.woff2")).toBe(Buffer.from([0, 1, 2, 3, 4, 5]).toString("base64"));
    expect(await rootFs.stat("binary/font.woff2")).toEqual(expect.objectContaining({ size: 6 }));
    expect(progress).toEqual([
      [2, 6],
      [4, 6],
      [6, 6]
    ]);
  });

  it("copies and removes directory trees within the root", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-root-fs-"
    });
    const rootFs = createFixtureRootFs(root.rootPath);

    await rootFs.writeText("fixtures/app.js", "console.log('v1');");
    await rootFs.writeText("fixtures/nested/data.json", "{\"ok\":true}");

    await rootFs.copyRecursive("fixtures", ".wraithwalker/scenarios/baseline/fixtures");
    await expect(rootFs.copyRecursive("missing", "copy")).rejects.toThrow("Path not found: missing");

    expect(await rootFs.readText(".wraithwalker/scenarios/baseline/fixtures/app.js")).toBe("console.log('v1');");
    expect(await rootFs.readJson<{ ok: boolean }>(".wraithwalker/scenarios/baseline/fixtures/nested/data.json")).toEqual({ ok: true });

    await rootFs.remove("fixtures", { recursive: true, force: true });
    expect(await rootFs.exists("fixtures/app.js")).toBe(false);
  });
});
