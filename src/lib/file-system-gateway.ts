import { arrayBufferToBase64 as defaultArrayBufferToBase64, base64ToBytes as defaultBase64ToBytes } from "./encoding.js";

interface FileBodyPayload {
  body: string;
  bodyEncoding: "utf8" | "base64";
}

interface FileSystemGatewayDependencies {
  base64ToBytes?: typeof defaultBase64ToBytes;
  arrayBufferToBase64?: typeof defaultArrayBufferToBase64;
}

export function createFileSystemGateway({
  base64ToBytes = defaultBase64ToBytes,
  arrayBufferToBase64 = defaultArrayBufferToBase64
}: FileSystemGatewayDependencies = {}) {
  async function ensureDirectory(rootHandle: FileSystemDirectoryHandle, parts: string[]): Promise<FileSystemDirectoryHandle> {
    let current = rootHandle;
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create: true });
    }
    return current;
  }

  async function resolveFileHandle(
    rootHandle: FileSystemDirectoryHandle,
    relativePath: string,
    create = false
  ): Promise<FileSystemFileHandle> {
    const parts = relativePath.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) {
      throw new Error(`Invalid relative path: ${relativePath}`);
    }

    const directory = await ensureDirectory(rootHandle, parts);
    return directory.getFileHandle(fileName, { create });
  }

  async function exists(rootHandle: FileSystemDirectoryHandle, relativePath: string): Promise<boolean> {
    try {
      await resolveFileHandle(rootHandle, relativePath, false);
      return true;
    } catch {
      return false;
    }
  }

  async function writeJson(rootHandle: FileSystemDirectoryHandle, relativePath: string, value: unknown): Promise<void> {
    const handle = await resolveFileHandle(rootHandle, relativePath, true);
    const writer = await handle.createWritable();
    await writer.write(JSON.stringify(value, null, 2));
    await writer.close();
  }

  async function writeBody(
    rootHandle: FileSystemDirectoryHandle,
    relativePath: string,
    payload: FileBodyPayload
  ): Promise<void> {
    const handle = await resolveFileHandle(rootHandle, relativePath, true);
    const writer = await handle.createWritable();

    if (payload.bodyEncoding === "base64") {
      const bytes = base64ToBytes(payload.body);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      await writer.write(buffer);
    } else {
      await writer.write(payload.body);
    }

    await writer.close();
  }

  async function readJson<T>(rootHandle: FileSystemDirectoryHandle, relativePath: string): Promise<T> {
    const handle = await resolveFileHandle(rootHandle, relativePath, false);
    const file = await handle.getFile();
    return JSON.parse(await file.text()) as T;
  }

  async function readOptionalJson<T>(rootHandle: FileSystemDirectoryHandle, relativePath: string): Promise<T | null> {
    const fileExists = await exists(rootHandle, relativePath);
    if (!fileExists) {
      return null;
    }

    return readJson<T>(rootHandle, relativePath);
  }

  async function readBody(rootHandle: FileSystemDirectoryHandle, relativePath: string): Promise<{ bodyBase64: string; size: number }> {
    const handle = await resolveFileHandle(rootHandle, relativePath, false);
    const file = await handle.getFile();

    return {
      bodyBase64: arrayBufferToBase64(await file.arrayBuffer()),
      size: file.size
    };
  }

  return {
    ensureDirectory,
    resolveFileHandle,
    exists,
    writeJson,
    writeBody,
    readJson,
    readOptionalJson,
    readBody
  };
}
