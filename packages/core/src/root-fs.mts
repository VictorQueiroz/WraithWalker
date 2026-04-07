import { promises as fs, type Stats } from "node:fs";
import path from "node:path";

export interface RootFsEntry {
  name: string;
  kind: "file" | "directory";
}

export interface WriteBodyOptions {
  onProgress?: (writtenBytes: number, totalBytes: number) => void | Promise<void>;
  chunkSize?: number;
}

export interface FixtureRootFs {
  rootPath: string;
  resolve(relativePath: string): string | null;
  exists(relativePath: string): Promise<boolean>;
  stat(relativePath: string): Promise<Stats | null>;
  readText(relativePath: string): Promise<string>;
  readOptionalText(relativePath: string): Promise<string | null>;
  readBodyAsBase64(relativePath: string): Promise<string>;
  readJson<T>(relativePath: string): Promise<T>;
  readOptionalJson<T>(relativePath: string): Promise<T | null>;
  writeText(relativePath: string, content: string): Promise<void>;
  writeJson(relativePath: string, value: unknown): Promise<void>;
  writeBody(
    relativePath: string,
    payload: { body: string; bodyEncoding: "utf8" | "base64" },
    options?: WriteBodyOptions
  ): Promise<void>;
  ensureDir(relativePath: string): Promise<void>;
  listDirectory(relativePath?: string): Promise<RootFsEntry[]>;
  listOptionalDirectory(relativePath?: string): Promise<RootFsEntry[]>;
  listDirectories(relativePath?: string): Promise<string[]>;
  listOptionalDirectories(relativePath?: string): Promise<string[]>;
  remove(relativePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  copyRecursive(sourceRelativePath: string, destRelativePath: string): Promise<void>;
}

export function resolveWithinRoot(rootPath: string, relativePath: string): string | null {
  if (path.isAbsolute(relativePath)) {
    return null;
  }

  const normalizedRoot = path.resolve(rootPath);
  const absolutePath = path.resolve(normalizedRoot, relativePath);
  const relativeToRoot = path.relative(normalizedRoot, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return null;
  }

  return absolutePath;
}

function requireWithinRoot(rootPath: string, relativePath: string): string {
  const resolved = resolveWithinRoot(rootPath, relativePath);
  if (!resolved) {
    throw new Error(`Path "${relativePath}" must stay within the fixture root.`);
  }

  return resolved;
}

export function createFixtureRootFs(rootPath: string): FixtureRootFs {
  async function copyRecursive(sourceRelativePath: string, destRelativePath: string): Promise<void> {
    const sourceStat = await stat(sourceRelativePath);
    if (!sourceStat) {
      throw new Error(`Path not found: ${sourceRelativePath}`);
    }

    if (!sourceStat.isDirectory()) {
      const sourceAbsolute = requireWithinRoot(rootPath, sourceRelativePath);
      const destAbsolute = requireWithinRoot(rootPath, destRelativePath);
      await fs.mkdir(path.dirname(destAbsolute), { recursive: true });
      await fs.copyFile(sourceAbsolute, destAbsolute);
      return;
    }

    await ensureDir(destRelativePath);
    const entries = await listDirectory(sourceRelativePath);
    for (const entry of entries) {
      await copyRecursive(
        path.join(sourceRelativePath, entry.name),
        path.join(destRelativePath, entry.name)
      );
    }
  }

  async function exists(relativePath: string): Promise<boolean> {
    const absolutePath = resolveWithinRoot(rootPath, relativePath);
    if (!absolutePath) {
      return false;
    }

    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  async function stat(relativePath: string): Promise<Stats | null> {
    const absolutePath = resolveWithinRoot(rootPath, relativePath);
    if (!absolutePath) {
      return null;
    }

    try {
      return await fs.lstat(absolutePath);
    } catch {
      return null;
    }
  }

  async function readText(relativePath: string): Promise<string> {
    return fs.readFile(requireWithinRoot(rootPath, relativePath), "utf8");
  }

  async function readOptionalText(relativePath: string): Promise<string | null> {
    try {
      return await readText(relativePath);
    } catch {
      return null;
    }
  }

  async function readJson<T>(relativePath: string): Promise<T> {
    return JSON.parse(await readText(relativePath)) as T;
  }

  async function readBodyAsBase64(relativePath: string): Promise<string> {
    const body = await fs.readFile(requireWithinRoot(rootPath, relativePath));
    return body.toString("base64");
  }

  async function readOptionalJson<T>(relativePath: string): Promise<T | null> {
    try {
      return await readJson<T>(relativePath);
    } catch {
      return null;
    }
  }

  async function writeText(relativePath: string, content: string): Promise<void> {
    const absolutePath = requireWithinRoot(rootPath, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  }

  async function writeJson(relativePath: string, value: unknown): Promise<void> {
    await writeText(relativePath, JSON.stringify(value, null, 2));
  }

  async function writeBody(
    relativePath: string,
    payload: { body: string; bodyEncoding: "utf8" | "base64" },
    options: WriteBodyOptions = {}
  ): Promise<void> {
    const absolutePath = requireWithinRoot(rootPath, relativePath);
    const bodyBuffer = payload.bodyEncoding === "base64"
      ? Buffer.from(payload.body, "base64")
      : Buffer.from(payload.body, "utf8");
    const chunkSize = Math.max(1, options.chunkSize ?? 64 * 1024);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const handle = await fs.open(absolutePath, "w");

    try {
      let writtenBytes = 0;
      while (writtenBytes < bodyBuffer.byteLength) {
        const nextChunk = bodyBuffer.subarray(writtenBytes, writtenBytes + chunkSize);
        await handle.write(nextChunk);
        writtenBytes += nextChunk.byteLength;
        if (options.onProgress) {
          await options.onProgress(writtenBytes, bodyBuffer.byteLength);
        }
      }
    } finally {
      await handle.close();
    }
  }

  async function ensureDir(relativePath: string): Promise<void> {
    await fs.mkdir(requireWithinRoot(rootPath, relativePath), { recursive: true });
  }

  async function listDirectory(relativePath = ""): Promise<RootFsEntry[]> {
    const absolutePath = requireWithinRoot(rootPath, relativePath);
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? "directory" as const : "file" as const
    }));
  }

  async function listOptionalDirectory(relativePath = ""): Promise<RootFsEntry[]> {
    try {
      return await listDirectory(relativePath);
    } catch {
      return [];
    }
  }

  async function listDirectories(relativePath = ""): Promise<string[]> {
    return (await listDirectory(relativePath))
      .filter((entry) => entry.kind === "directory")
      .map((entry) => entry.name);
  }

  async function listOptionalDirectories(relativePath = ""): Promise<string[]> {
    return (await listOptionalDirectory(relativePath))
      .filter((entry) => entry.kind === "directory")
      .map((entry) => entry.name);
  }

  async function remove(
    relativePath: string,
    options: { recursive?: boolean; force?: boolean } = {}
  ): Promise<void> {
    await fs.rm(requireWithinRoot(rootPath, relativePath), options);
  }

  return {
    rootPath,
    resolve(relativePath) {
      return resolveWithinRoot(rootPath, relativePath);
    },
    exists,
    stat,
    readText,
    readOptionalText,
    readBodyAsBase64,
    readJson,
    readOptionalJson,
    writeText,
    writeJson,
    writeBody,
    ensureDir,
    listDirectory,
    listOptionalDirectory,
    listDirectories,
    listOptionalDirectories,
    remove,
    copyRecursive
  };
}
