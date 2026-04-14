import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ROOT_DIRECTORY_PICKER_ID,
  ROOT_HANDLE_KEY,
  ROOT_SENTINEL_DIR,
  ROOT_SENTINEL_FILE,
  ROOT_SENTINEL_SCHEMA_VERSION
} from "../src/lib/constants.js";

const mocks = vi.hoisted(() => ({
  idbGet: vi.fn(),
  idbSet: vi.fn()
}));

vi.mock("../src/lib/idb.js", () => ({
  idbGet: mocks.idbGet,
  idbSet: mocks.idbSet
}));

import {
  createRootDirectoryPickerOptions,
  ensureRootSentinel,
  loadStoredRootHandle,
  queryRootPermission,
  requestRootPermission,
  storeRootHandleWithSentinel
} from "../src/lib/root-handle.js";

class MockFileHandle {
  content: string;
  pendingContent: string;

  constructor(content = "") {
    this.content = content;
    this.pendingContent = content;
  }

  async getFile() {
    return {
      text: async () => this.content
    };
  }

  async createWritable() {
    return {
      write: async (content: string) => {
        this.pendingContent = content;
      },
      close: async () => {
        this.content = this.pendingContent;
      }
    };
  }
}

class MockDirectoryHandle {
  permission: PermissionState;
  directories: Map<string, MockDirectoryHandle>;
  files: Map<string, MockFileHandle>;

  constructor(permission = "granted") {
    this.permission = permission as PermissionState;
    this.directories = new Map();
    this.files = new Map();
  }

  async getDirectoryHandle(
    name: string,
    { create = false }: { create?: boolean } = {}
  ) {
    if (!this.directories.has(name)) {
      if (!create) {
        throw new Error(`Missing directory: ${name}`);
      }
      this.directories.set(name, new MockDirectoryHandle(this.permission));
    }
    return this.directories.get(name);
  }

  async getFileHandle(
    name: string,
    { create = false }: { create?: boolean } = {}
  ) {
    if (!this.files.has(name)) {
      if (!create) {
        throw new Error(`Missing file: ${name}`);
      }
      this.files.set(name, new MockFileHandle());
    }
    return this.files.get(name);
  }

  async queryPermission() {
    return this.permission;
  }

  async requestPermission() {
    return this.permission;
  }
}

async function writeSentinel(rootHandle, sentinel) {
  const metaDirectory = await rootHandle.getDirectoryHandle(ROOT_SENTINEL_DIR, {
    create: true
  });
  const fileHandle = await metaDirectory.getFileHandle(ROOT_SENTINEL_FILE, {
    create: true
  });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(sentinel, null, 2));
  await writable.close();
}

function asFileSystemDirectoryHandle(
  handle: MockDirectoryHandle
): FileSystemDirectoryHandle {
  return handle as unknown as FileSystemDirectoryHandle;
}

describe("root handle helpers", () => {
  beforeEach(() => {
    mocks.idbGet.mockReset();
    mocks.idbSet.mockReset();
  });

  it("loads the stored root handle from idb", async () => {
    const rootHandle = new MockDirectoryHandle();
    mocks.idbGet.mockResolvedValue(rootHandle);

    await expect(loadStoredRootHandle()).resolves.toBe(rootHandle);
    expect(mocks.idbGet).toHaveBeenCalledWith(ROOT_HANDLE_KEY);
  });

  it("returns an existing sentinel when present", async () => {
    const rootHandle = new MockDirectoryHandle();
    const sentinel = {
      rootId: "root-123",
      schemaVersion: ROOT_SENTINEL_SCHEMA_VERSION,
      createdAt: "2026-04-03T00:00:00.000Z"
    };
    await writeSentinel(rootHandle, sentinel);

    await expect(
      ensureRootSentinel(asFileSystemDirectoryHandle(rootHandle))
    ).resolves.toEqual(sentinel);
  });

  it("creates and stores a sentinel when missing", async () => {
    const rootHandle = new MockDirectoryHandle();

    const sentinel = await ensureRootSentinel(
      asFileSystemDirectoryHandle(rootHandle)
    );
    const metaDirectory = await rootHandle.getDirectoryHandle(
      ROOT_SENTINEL_DIR,
      { create: false }
    );
    const fileHandle = await metaDirectory.getFileHandle(ROOT_SENTINEL_FILE, {
      create: false
    });
    const stored = JSON.parse(await (await fileHandle.getFile()).text());

    expect(sentinel.rootId).toBeTypeOf("string");
    expect(sentinel.schemaVersion).toBe(ROOT_SENTINEL_SCHEMA_VERSION);
    expect(stored).toEqual(sentinel);
  });

  it("returns prompt when no handle is available and delegates otherwise", async () => {
    const rootHandle = new MockDirectoryHandle("granted");

    await expect(queryRootPermission()).resolves.toBe("prompt");
    await expect(requestRootPermission(null)).resolves.toBe("prompt");
    await expect(
      queryRootPermission(asFileSystemDirectoryHandle(rootHandle))
    ).resolves.toBe("granted");
    await expect(
      requestRootPermission(asFileSystemDirectoryHandle(rootHandle))
    ).resolves.toBe("granted");
  });

  it("stores the root handle after ensuring a sentinel", async () => {
    const rootHandle = new MockDirectoryHandle();

    const sentinel = await storeRootHandleWithSentinel(
      asFileSystemDirectoryHandle(rootHandle)
    );

    expect(sentinel.rootId).toBeTypeOf("string");
    expect(mocks.idbSet).toHaveBeenCalledWith(ROOT_HANDLE_KEY, rootHandle);
  });

  it("creates remembered picker options with an id and optional start handle", () => {
    const rootHandle = asFileSystemDirectoryHandle(new MockDirectoryHandle());

    expect(createRootDirectoryPickerOptions()).toEqual({
      mode: "readwrite",
      id: ROOT_DIRECTORY_PICKER_ID
    });
    expect(createRootDirectoryPickerOptions(rootHandle)).toEqual({
      mode: "readwrite",
      id: ROOT_DIRECTORY_PICKER_ID,
      startIn: rootHandle
    });
  });
});
