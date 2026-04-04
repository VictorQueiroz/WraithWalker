import { promises as fs } from "node:fs";
import path from "node:path";

export interface FsGateway {
  exists(rootPath: string, relativePath: string): Promise<boolean>;
  readJson<T>(rootPath: string, relativePath: string): Promise<T>;
  readOptionalJson<T>(rootPath: string, relativePath: string): Promise<T | null>;
  readText(rootPath: string, relativePath: string): Promise<string>;
  writeText(rootPath: string, relativePath: string, content: string): Promise<void>;
  writeJson(rootPath: string, relativePath: string, value: unknown): Promise<void>;
  listDirectory(rootPath: string, relativePath: string): Promise<Array<{ name: string; kind: "file" | "directory" }>>;
}

export function createFsGateway(): FsGateway {
  return {
    async exists(rootPath, relativePath) {
      try {
        await fs.access(path.join(rootPath, relativePath));
        return true;
      } catch {
        return false;
      }
    },

    async readJson(rootPath, relativePath) {
      const content = await fs.readFile(path.join(rootPath, relativePath), "utf8");
      return JSON.parse(content);
    },

    async readOptionalJson(rootPath, relativePath) {
      try {
        const content = await fs.readFile(path.join(rootPath, relativePath), "utf8");
        return JSON.parse(content);
      } catch {
        return null;
      }
    },

    async readText(rootPath, relativePath) {
      return fs.readFile(path.join(rootPath, relativePath), "utf8");
    },

    async writeText(rootPath, relativePath, content) {
      const absolute = path.join(rootPath, relativePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, "utf8");
    },

    async writeJson(rootPath, relativePath, value) {
      const absolute = path.join(rootPath, relativePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, JSON.stringify(value, null, 2), "utf8");
    },

    async listDirectory(rootPath, relativePath) {
      const dirPath = relativePath ? path.join(rootPath, relativePath) : rootPath;
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        kind: e.isDirectory() ? "directory" as const : "file" as const
      }));
    }
  };
}
