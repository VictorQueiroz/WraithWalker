import { describe, expect, it, vi } from "vitest";

import {
  getRevealRootLaunch,
  revealRootDirectory
} from "../src/root-reveal.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

describe("root reveal helper", () => {
  it("builds platform-specific OS launch commands", () => {
    expect(getRevealRootLaunch("/tmp/wraithwalker", "darwin")).toEqual({
      command: "open '/tmp/wraithwalker'",
      program: "open",
      args: ["/tmp/wraithwalker"]
    });

    expect(getRevealRootLaunch("C:\\\\WraithWalker", "win32")).toEqual({
      command: "cmd /c start \"\" 'C:\\\\WraithWalker'",
      program: "cmd",
      args: ["/c", "start", "", "C:\\\\WraithWalker"]
    });

    expect(getRevealRootLaunch("/tmp/wraithwalker", "linux")).toEqual({
      command: "xdg-open '/tmp/wraithwalker'",
      program: "xdg-open",
      args: ["/tmp/wraithwalker"]
    });
  });

  it("reveals the verified root through the OS handler", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-root-reveal-",
      rootId: "root-reveal"
    });
    const spawnChild = { unref: vi.fn() };
    const spawnMock = vi.fn().mockReturnValue(spawnChild as any);

    const result = await revealRootDirectory(
      {
        rootPath: root.rootPath,
        expectedRootId: root.rootId
      },
      spawnMock as any
    );

    const launch = getRevealRootLaunch(root.rootPath);
    expect(result).toEqual({
      ok: true,
      command: launch.command
    });
    expect(spawnMock).toHaveBeenCalledWith(launch.program, launch.args, {
      detached: true,
      stdio: "ignore"
    });
    expect(spawnChild.unref).toHaveBeenCalled();
  });

  it("rejects mismatched root sentinels before spawning a launcher", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-root-reveal-",
      rootId: "root-reveal"
    });
    const spawnMock = vi.fn();

    await expect(
      revealRootDirectory(
        {
          rootPath: root.rootPath,
          expectedRootId: "wrong-root"
        },
        spawnMock as any
      )
    ).rejects.toThrow("Sentinel root ID mismatch.");
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
