import path from "node:path";

export const ROOT_SENTINEL_RELATIVE_PATH = path.join(".wraithwalker", "root.json");
export const ROOT_SENTINEL_SCHEMA_VERSION = 1;
export const SCENARIOS_DIR = path.join(".wraithwalker", "scenarios");

export const SIMPLE_METADATA_DIR = ".wraithwalker";
export const SIMPLE_METADATA_TREE = "simple";
export const STATIC_RESOURCE_MANIFEST_FILE = "RESOURCE_MANIFEST.json";

export const FIXTURE_FILE_NAMES = {
  API_REQUEST: "request.json",
  API_META: "response.meta.json"
} as const;

export const EDITOR_CONTEXT_FILES: Record<string, string[]> = {
  cursor: ["CLAUDE.md", ".cursorrules"],
  antigravity: ["CLAUDE.md"],
  vscode: ["CLAUDE.md"],
  windsurf: ["CLAUDE.md", ".windsurfrules"]
};

export const DEFAULT_CONTEXT_FILES = ["CLAUDE.md"];
