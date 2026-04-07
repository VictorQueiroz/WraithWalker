import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveDefaultServeRoot, resolveServeRoot } from "../src/lib/serve-root.mts";

describe("serve root resolution", () => {
  it("resolves platform default roots", () => {
    expect(resolveDefaultServeRoot({
      platform: "darwin",
      homeDir: "/Users/tester",
      env: {}
    })).toBe("/Users/tester/Library/Application Support/WraithWalker");

    expect(resolveDefaultServeRoot({
      platform: "linux",
      homeDir: "/home/tester",
      env: {}
    })).toBe("/home/tester/.local/share/wraithwalker");

    expect(resolveDefaultServeRoot({
      platform: "linux",
      homeDir: "/home/tester",
      env: { XDG_DATA_HOME: "/tmp/xdg-data" }
    })).toBe("/tmp/xdg-data/wraithwalker");

    expect(resolveDefaultServeRoot({
      platform: "win32",
      homeDir: "C:\\Users\\tester",
      env: { LOCALAPPDATA: "C:\\LocalAppData" }
    })).toBe(path.join("C:\\LocalAppData", "WraithWalker"));
  });

  it("prefers explicit dir, then env root, then platform default", () => {
    expect(resolveServeRoot({
      cwd: "/workspace",
      explicitDir: "fixtures",
      env: { WRAITHWALKER_ROOT: "/env/root" },
      platform: "linux",
      homeDir: "/home/tester"
    })).toBe("/workspace/fixtures");

    expect(resolveServeRoot({
      cwd: "/workspace",
      env: { WRAITHWALKER_ROOT: "fixtures-from-env" },
      platform: "linux",
      homeDir: "/home/tester"
    })).toBe("/workspace/fixtures-from-env");

    expect(resolveServeRoot({
      cwd: "/workspace",
      env: {},
      platform: "linux",
      homeDir: "/home/tester"
    })).toBe("/home/tester/.local/share/wraithwalker");
  });
});
