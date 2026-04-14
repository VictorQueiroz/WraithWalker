import path from "node:path";
import { promises as fs } from "node:fs";

import { describe, expect, it } from "vitest";

import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";
import {
  resolveDefaultServeRoot,
  resolveServeRoot
} from "../src/lib/serve-root.mts";

describe("serve root resolution", () => {
  it("resolves platform default roots", () => {
    expect(
      resolveDefaultServeRoot({
        platform: "darwin",
        homeDir: "/Users/tester",
        env: {}
      })
    ).toBe("/Users/tester/Library/Application Support/WraithWalker");

    expect(
      resolveDefaultServeRoot({
        platform: "linux",
        homeDir: "/home/tester",
        env: {}
      })
    ).toBe("/home/tester/.local/share/wraithwalker");

    expect(
      resolveDefaultServeRoot({
        platform: "linux",
        homeDir: "/home/tester",
        env: { XDG_DATA_HOME: "/tmp/xdg-data" }
      })
    ).toBe("/tmp/xdg-data/wraithwalker");

    expect(
      resolveDefaultServeRoot({
        platform: "win32",
        homeDir: "C:\\Users\\tester",
        env: { LOCALAPPDATA: "C:\\LocalAppData" }
      })
    ).toBe(path.join("C:\\LocalAppData", "WraithWalker"));
  });

  it("prefers explicit dir, then env root, then current fixture root, then platform default", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-cli-serve-root-"
    });
    const nestedDir = path.join(root.rootPath, "nested", "inside");
    await fs.mkdir(nestedDir, { recursive: true });

    await expect(
      resolveServeRoot({
        cwd: nestedDir,
        explicitDir: "fixtures",
        env: { WRAITHWALKER_ROOT: "/env/root" },
        platform: "linux",
        homeDir: "/home/tester"
      })
    ).resolves.toBe(path.join(nestedDir, "fixtures"));

    await expect(
      resolveServeRoot({
        cwd: nestedDir,
        env: { WRAITHWALKER_ROOT: "fixtures-from-env" },
        platform: "linux",
        homeDir: "/home/tester"
      })
    ).resolves.toBe(path.join(nestedDir, "fixtures-from-env"));

    await expect(
      resolveServeRoot({
        cwd: nestedDir,
        env: {},
        platform: "linux",
        homeDir: "/home/tester"
      })
    ).resolves.toBe(root.rootPath);

    await expect(
      resolveServeRoot({
        cwd: "/workspace",
        env: {},
        platform: "linux",
        homeDir: "/home/tester"
      })
    ).resolves.toBe("/home/tester/.local/share/wraithwalker");
  });
});
