import { describe, expect, it, vi } from "vitest";

import {
  parseArgs,
  parsePort,
  renderHttpStartup,
  runBin
} from "../src/bin.mts";

describe("mcp server bin", () => {
  it("prefers argv root path over env and cwd", async () => {
    const startServer = vi.fn().mockResolvedValue(undefined);

    await runBin({
      argv: ["/tmp/from-argv"],
      env: { WRAITHWALKER_ROOT: "/tmp/from-env" },
      cwd: "/tmp/from-cwd",
      startServerImpl: startServer
    });

    expect(startServer).toHaveBeenCalledWith("/tmp/from-argv");
  });

  it("uses WRAITHWALKER_ROOT when argv is missing", async () => {
    const startServer = vi.fn().mockResolvedValue(undefined);

    await runBin({
      argv: [],
      env: { WRAITHWALKER_ROOT: "/tmp/from-env" },
      cwd: "/tmp/from-cwd",
      startServerImpl: startServer
    });

    expect(startServer).toHaveBeenCalledWith("/tmp/from-env");
  });

  it("falls back to process.cwd()", async () => {
    const startServer = vi.fn().mockResolvedValue(undefined);

    await runBin({
      argv: [],
      cwd: "/tmp/from-cwd",
      startServerImpl: startServer
    });

    expect(startServer).toHaveBeenCalledWith("/tmp/from-cwd");
  });

  it("parses the supported CLI flags", () => {
    expect(
      parseArgs(["--http", "--host", "0.0.0.0", "--port", "8321", "/tmp/root"])
    ).toEqual({
      http: true,
      host: "0.0.0.0",
      port: 8321,
      rootPath: "/tmp/root"
    });
  });

  it("starts the HTTP server with default host and port", async () => {
    const startHttpServer = vi.fn().mockResolvedValue({
      rootPath: "/tmp/from-argv",
      host: "127.0.0.1",
      port: 4319,
      url: "http://127.0.0.1:4319/mcp",
      tools: ["list-sites"],
      close: vi.fn().mockResolvedValue(undefined)
    });
    const writeLine = vi.fn();

    await runBin({
      argv: ["--http", "/tmp/from-argv"],
      startHttpServerImpl: startHttpServer,
      writeLine
    });

    expect(startHttpServer).toHaveBeenCalledWith("/tmp/from-argv", {
      host: "127.0.0.1",
      port: 4319
    });
    expect(writeLine).toHaveBeenCalledWith("MCP Server Ready");
    expect(writeLine).toHaveBeenCalledWith("URL: http://127.0.0.1:4319/mcp");
  });

  it("accepts custom HTTP host and port flags", async () => {
    const startHttpServer = vi.fn().mockResolvedValue({
      rootPath: "/tmp/from-cwd",
      host: "0.0.0.0",
      port: 8321,
      url: "http://0.0.0.0:8321/mcp",
      tools: ["list-sites"],
      close: vi.fn().mockResolvedValue(undefined)
    });

    await runBin({
      argv: ["--http", "--host", "0.0.0.0", "--port", "8321"],
      cwd: "/tmp/from-cwd",
      startHttpServerImpl: startHttpServer,
      writeLine: vi.fn()
    });

    expect(startHttpServer).toHaveBeenCalledWith("/tmp/from-cwd", {
      host: "0.0.0.0",
      port: 8321
    });
  });

  it("starts the stdio server when HTTP mode is disabled", async () => {
    const startServer = vi.fn().mockResolvedValue(undefined);

    await runBin({
      argv: ["/tmp/from-argv"],
      startServerImpl: startServer
    });

    expect(startServer).toHaveBeenCalledWith("/tmp/from-argv");
  });

  it("renders HTTP startup output line by line", () => {
    const writeLine = vi.fn();

    renderHttpStartup(
      {
        host: "127.0.0.1",
        port: 4319,
        url: "http://127.0.0.1:4319/mcp"
      },
      "/tmp/root",
      writeLine
    );

    expect(writeLine.mock.calls).toEqual([
      ["MCP Server Ready"],
      ["Root: /tmp/root"],
      ["Transport: streamable-http"],
      ["Host: 127.0.0.1"],
      ["Port: 4319"],
      ["URL: http://127.0.0.1:4319/mcp"]
    ]);
  });

  it("rejects a missing HTTP host value", () => {
    expect(() => parseArgs(["--http", "--host"])).toThrow(
      "Missing value for --host."
    );
  });

  it("rejects a missing HTTP port value", () => {
    expect(() => parseArgs(["--http", "--port"])).toThrow(
      "Missing value for --port."
    );
  });

  it("rejects invalid HTTP ports", () => {
    expect(() => parsePort("70000")).toThrow("Invalid port: 70000");
  });

  it("requires HTTP mode before accepting host and port flags", () => {
    expect(() => parseArgs(["--host", "127.0.0.1"])).toThrow(
      "--host and --port require --http."
    );
    expect(() => parseArgs(["--port", "4319"])).toThrow(
      "--host and --port require --http."
    );
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--mystery"])).toThrow(
      "Unknown argument: --mystery"
    );
  });

  it("rejects extra positional arguments", () => {
    expect(() => parseArgs(["/tmp/root", "/tmp/extra"])).toThrow(
      "Unexpected extra positional argument: /tmp/extra"
    );
  });
});
