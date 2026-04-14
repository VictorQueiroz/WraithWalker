import {
  ROOT_DIRECTORY_PICKER_ID,
  ROOT_HANDLE_KEY,
  ROOT_SENTINEL_DIR,
  ROOT_SENTINEL_FILE,
  ROOT_SENTINEL_SCHEMA_VERSION
} from "./constants.js";
import { idbGet, idbSet } from "./idb.js";
import type { RootSentinel } from "./types.js";

export interface RootDirectoryPickerOptions {
  mode: "readwrite";
  id: string;
  startIn?: FileSystemDirectoryHandle;
}

function randomId(): string {
  return crypto.randomUUID();
}

export async function loadStoredRootHandle(): Promise<
  FileSystemDirectoryHandle | undefined
> {
  return idbGet<FileSystemDirectoryHandle>(ROOT_HANDLE_KEY);
}

export function createRootDirectoryPickerOptions(
  rootHandle?: FileSystemDirectoryHandle | null
): RootDirectoryPickerOptions {
  return rootHandle
    ? {
        mode: "readwrite",
        id: ROOT_DIRECTORY_PICKER_ID,
        startIn: rootHandle
      }
    : {
        mode: "readwrite",
        id: ROOT_DIRECTORY_PICKER_ID
      };
}

export async function persistRootHandle(
  rootHandle: FileSystemDirectoryHandle
): Promise<void> {
  await idbSet(ROOT_HANDLE_KEY, rootHandle);
}

async function readJsonFile<T>(fileHandle: FileSystemFileHandle): Promise<T> {
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text()) as T;
}

async function writeJsonFile(
  fileHandle: FileSystemFileHandle,
  data: unknown
): Promise<void> {
  const writer = await fileHandle.createWritable();
  await writer.write(JSON.stringify(data, null, 2));
  await writer.close();
}

async function getSentinelFileHandle(
  rootHandle: FileSystemDirectoryHandle,
  create = false
): Promise<FileSystemFileHandle> {
  const metaDirectory = await rootHandle.getDirectoryHandle(ROOT_SENTINEL_DIR, {
    create
  });
  return metaDirectory.getFileHandle(ROOT_SENTINEL_FILE, { create });
}

export async function ensureRootSentinel(
  rootHandle: FileSystemDirectoryHandle
): Promise<RootSentinel> {
  try {
    const fileHandle = await getSentinelFileHandle(rootHandle, false);
    const existing = await readJsonFile<RootSentinel>(fileHandle);
    return existing;
  } catch {
    const sentinel: RootSentinel = {
      rootId: randomId(),
      schemaVersion: ROOT_SENTINEL_SCHEMA_VERSION,
      createdAt: new Date().toISOString()
    };
    const fileHandle = await getSentinelFileHandle(rootHandle, true);
    await writeJsonFile(fileHandle, sentinel);
    return sentinel;
  }
}

export async function queryRootPermission(
  rootHandle?: FileSystemDirectoryHandle | null
): Promise<PermissionState> {
  if (!rootHandle) {
    return "prompt";
  }
  return rootHandle.queryPermission
    ? rootHandle.queryPermission({ mode: "readwrite" })
    : "prompt";
}

export async function requestRootPermission(
  rootHandle?: FileSystemDirectoryHandle | null
): Promise<PermissionState> {
  if (!rootHandle) {
    return "prompt";
  }
  return rootHandle.requestPermission
    ? rootHandle.requestPermission({ mode: "readwrite" })
    : "prompt";
}

export async function storeRootHandleWithSentinel(
  rootHandle: FileSystemDirectoryHandle
): Promise<RootSentinel> {
  const sentinel = await ensureRootSentinel(rootHandle);
  await persistRootHandle(rootHandle);
  return sentinel;
}
