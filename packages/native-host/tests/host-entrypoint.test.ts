import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

function createNativeMessage(payload: unknown): Buffer {
  const content = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(content.length, 0);
  return Buffer.concat([header, content]);
}

async function loadHostModule() {
  vi.resetModules();

  const mocks = {
    verifyRoot: vi.fn().mockResolvedValue({ ok: true, via: "verifyRoot" }),
    openDirectory: vi
      .fn()
      .mockResolvedValue({ ok: true, via: "openDirectory" }),
    revealDirectory: vi
      .fn()
      .mockResolvedValue({ ok: true, via: "revealDirectory" }),
    saveScenario: vi.fn().mockResolvedValue({ ok: true, via: "saveScenario" }),
    switchScenario: vi
      .fn()
      .mockResolvedValue({ ok: true, via: "switchScenario" }),
    listScenarios: vi.fn().mockResolvedValue({ ok: true, via: "listScenarios" }),
    diffScenarios: vi.fn().mockResolvedValue({ ok: true, via: "diffScenarios" })
  };

  vi.doMock("../src/lib.mjs", () => mocks);

  return {
    host: await import("../src/host.mts"),
    mocks
  };
}

async function loadHostModuleWithArgv(argv: string[]) {
  const originalArgv = process.argv;
  process.argv = argv;

  try {
    return await loadHostModule();
  } finally {
    process.argv = originalArgv;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unmock("../src/lib.mjs");
});

describe("native host entrypoint", () => {
  it("writes length-prefixed JSON payloads to stdout", async () => {
    const { host } = await loadHostModule();
    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    host.writeMessage({ ok: true, message: "hello" });

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    const payload = stdoutWrite.mock.calls[0]?.[0];
    expect(Buffer.isBuffer(payload)).toBe(true);

    const buffer = payload as Buffer;
    const messageLength = buffer.readUInt32LE(0);
    const body = JSON.parse(buffer.subarray(4).toString("utf8"));

    expect(messageLength).toBe(buffer.length - 4);
    expect(body).toEqual({ ok: true, message: "hello" });
  });

  it("dispatches known message types to the matching lib helpers", async () => {
    const { host, mocks } = await loadHostModule();

    await expect(host.handleMessage({ type: "verifyRoot" })).resolves.toEqual({
      ok: true,
      via: "verifyRoot"
    });
    await expect(
      host.handleMessage({ type: "openDirectory" })
    ).resolves.toEqual({ ok: true, via: "openDirectory" });
    await expect(
      host.handleMessage({ type: "revealDirectory" })
    ).resolves.toEqual({ ok: true, via: "revealDirectory" });
    await expect(host.handleMessage({ type: "saveScenario" })).resolves.toEqual(
      { ok: true, via: "saveScenario" }
    );
    await expect(
      host.handleMessage({ type: "switchScenario" })
    ).resolves.toEqual({ ok: true, via: "switchScenario" });
    await expect(
      host.handleMessage({ type: "listScenarios" })
    ).resolves.toEqual({ ok: true, via: "listScenarios" });
    await expect(
      host.handleMessage({ type: "diffScenarios" })
    ).resolves.toEqual({ ok: true, via: "diffScenarios" });

    expect(mocks.verifyRoot).toHaveBeenCalledWith({ type: "verifyRoot" });
    expect(mocks.openDirectory).toHaveBeenCalledWith({ type: "openDirectory" });
    expect(mocks.revealDirectory).toHaveBeenCalledWith({
      type: "revealDirectory"
    });
    expect(mocks.saveScenario).toHaveBeenCalledWith({ type: "saveScenario" });
    expect(mocks.switchScenario).toHaveBeenCalledWith({
      type: "switchScenario"
    });
    expect(mocks.listScenarios).toHaveBeenCalledWith({ type: "listScenarios" });
    expect(mocks.diffScenarios).toHaveBeenCalledWith({
      type: "diffScenarios"
    });
  });

  it("rejects unknown message types", async () => {
    const { host } = await loadHostModule();

    await expect(host.handleMessage({ type: "mystery" })).rejects.toThrow(
      "Unknown message type: mystery"
    );
  });

  it("parses length-prefixed input and writes the handler response", async () => {
    const { host } = await loadHostModule();
    const handleMessageImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, result: 42 });
    const writeMessageImpl = vi.fn();

    await host.main({
      stdin: [
        createNativeMessage({ type: "verifyRoot", expectedRootId: "root-123" })
      ],
      handleMessageImpl,
      writeMessageImpl
    });

    expect(handleMessageImpl).toHaveBeenCalledWith({
      type: "verifyRoot",
      expectedRootId: "root-123"
    });
    expect(writeMessageImpl).toHaveBeenCalledWith({ ok: true, result: 42 });
  });

  it("accepts string chunks when reading the native host message body", async () => {
    const { host } = await loadHostModule();
    const handleMessageImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, result: 7 });
    const writeMessageImpl = vi.fn();

    await host.main({
      stdin: [
        createNativeMessage({
          type: "verifyRoot",
          expectedRootId: "root-123"
        }).toString("utf8")
      ],
      handleMessageImpl,
      writeMessageImpl
    });

    expect(handleMessageImpl).toHaveBeenCalledWith({
      type: "verifyRoot",
      expectedRootId: "root-123"
    });
    expect(writeMessageImpl).toHaveBeenCalledWith({ ok: true, result: 7 });
  });

  it("rejects malformed messages that are missing the length prefix", async () => {
    const { host } = await loadHostModule();

    await expect(host.main({ stdin: [Buffer.from("bad")] })).rejects.toThrow(
      "Native host expected a length-prefixed message."
    );
  });

  it("rejects truncated length-prefixed messages", async () => {
    const { host } = await loadHostModule();

    await expect(
      host.main({
        stdin: [createNativeMessage({ type: "verifyRoot" }).subarray(0, 8)]
      })
    ).rejects.toThrow(
      "Native host received a truncated length-prefixed message."
    );
  });

  it("serializes entrypoint errors through the native host response channel", async () => {
    const { host } = await loadHostModule();
    const writeMessageImpl = vi.fn();

    await host.runEntrypoint({
      stdin: [Buffer.from("bad")],
      writeMessageImpl
    });

    expect(writeMessageImpl).toHaveBeenCalledWith({
      ok: false,
      error: "Native host expected a length-prefixed message."
    });
  });

  it("passes successful entrypoint responses through without rewriting them", async () => {
    const { host } = await loadHostModule();
    const handleMessageImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, result: "done" });
    const writeMessageImpl = vi.fn();

    await host.runEntrypoint({
      stdin: [
        createNativeMessage({ type: "verifyRoot", expectedRootId: "root-123" })
      ],
      handleMessageImpl,
      writeMessageImpl
    });

    expect(writeMessageImpl).toHaveBeenCalledWith({ ok: true, result: "done" });
  });

  it("falls back to the default native host writer when no custom writer is provided", async () => {
    const { host } = await loadHostModule();
    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    await host.runEntrypoint({
      stdin: [Buffer.from("bad")]
    });

    expect(stdoutWrite).toHaveBeenCalledTimes(1);

    const payload = stdoutWrite.mock.calls[0]?.[0] as Buffer;
    const messageLength = payload.readUInt32LE(0);
    const body = JSON.parse(payload.subarray(4).toString("utf8"));

    expect(messageLength).toBe(payload.length - 4);
    expect(body).toEqual({
      ok: false,
      error: "Native host expected a length-prefixed message."
    });
  });

  it("stringifies non-Error entrypoint failures", async () => {
    const { host } = await loadHostModule();
    const writeMessageImpl = vi.fn();

    await host.runEntrypoint({
      stdin: [createNativeMessage({ type: "verifyRoot" })],
      handleMessageImpl: vi.fn().mockRejectedValue("plain failure"),
      writeMessageImpl
    });

    expect(writeMessageImpl).toHaveBeenCalledWith({
      ok: false,
      error: "plain failure"
    });
  });

  it("does not auto-run when imported without an entrypoint argv", async () => {
    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    await loadHostModuleWithArgv([process.argv[0] ?? "node"]);

    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it("treats symlinked entrypoint paths as direct execution", async () => {
    const { host } = await loadHostModule();
    const symlinkDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "wraithwalker-host-symlink-")
    );
    const symlinkPath = path.join(symlinkDir, "host-link.mts");

    try {
      await fs.symlink(
        fileURLToPath(new URL("../src/host.mts", import.meta.url)),
        symlinkPath
      );

      expect(
        host.isDirectExecution([process.argv[0] ?? "node", symlinkPath])
      ).toBe(true);
    } finally {
      await fs.rm(symlinkDir, { recursive: true, force: true });
    }
  });
});
