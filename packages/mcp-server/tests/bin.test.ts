import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = process.argv;

async function loadBin(which: "argv" | "env" | "cwd", startServer = vi.fn().mockResolvedValue(undefined)) {
  vi.resetModules();
  vi.doMock("../src/server.mjs", () => ({
    startServer
  }));

  switch (which) {
    case "argv":
      await import("../src/bin.mts?argv");
      break;
    case "env":
      await import("../src/bin.mts?env");
      break;
    case "cwd":
      await import("../src/bin.mts?cwd");
      break;
  }

  return { startServer };
}

afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.doUnmock("../src/server.mjs");
});

describe("mcp server bin", () => {
  it("prefers argv root path over env and cwd", async () => {
    process.argv = ["node", "wraithwalker-mcp", "/tmp/from-argv"];
    vi.stubEnv("WRAITHWALKER_ROOT", "/tmp/from-env");
    vi.spyOn(process, "cwd").mockReturnValue("/tmp/from-cwd");

    const { startServer } = await loadBin("argv");
    expect(startServer).toHaveBeenCalledWith("/tmp/from-argv");
  });

  it("uses WRAITHWALKER_ROOT when argv is missing", async () => {
    process.argv = ["node", "wraithwalker-mcp"];
    vi.stubEnv("WRAITHWALKER_ROOT", "/tmp/from-env");
    vi.spyOn(process, "cwd").mockReturnValue("/tmp/from-cwd");

    const { startServer } = await loadBin("env");
    expect(startServer).toHaveBeenCalledWith("/tmp/from-env");
  });

  it("falls back to process.cwd()", async () => {
    process.argv = ["node", "wraithwalker-mcp"];
    vi.spyOn(process, "cwd").mockReturnValue("/tmp/from-cwd");

    const { startServer } = await loadBin("cwd");
    expect(startServer).toHaveBeenCalledWith("/tmp/from-cwd");
  });
});
