import type { NativeHostConfig } from "./types.js";

export const DEFAULT_SITE_MODE = "simple" as const;
export const LEGACY_SITE_MODE = "advanced" as const;
export const DEFAULT_DUMP_ALLOWLIST_PATTERN = "\\.m?(js|ts)x?$";
export const DEFAULT_DUMP_ALLOWLIST_PATTERNS: string[] = [DEFAULT_DUMP_ALLOWLIST_PATTERN];

export const STORAGE_KEYS = {
  SITES: "siteConfigs",
  NATIVE_HOST: "nativeHostConfig",
  LAST_SESSION: "lastSessionSnapshot",
  PREFERRED_EDITOR: "preferredEditorId"
} as const;

export const DEFAULT_NATIVE_HOST_CONFIG: NativeHostConfig = {
  hostName: "com.wraithwalker.host",
  launchPath: "",
  editorLaunchOverrides: {}
};

export const IDB_NAME = "wraithwalker";
export const IDB_VERSION = 1;
export const IDB_STORE = "handles";
export const ROOT_HANDLE_KEY = "rootDirectory";

export const ROOT_SENTINEL_DIR = ".wraithwalker";
export const ROOT_SENTINEL_FILE = "root.json";
export const ROOT_SENTINEL_SCHEMA_VERSION = 1;
export const ROOT_DIRECTORY_PICKER_ID = "wraithwalker-root";
export const SIMPLE_MODE_METADATA_DIR = ".wraithwalker";
export const SIMPLE_MODE_METADATA_TREE = "simple";

export const OFFSCREEN_URL = "offscreen.html";
export const OFFSCREEN_REASONS = ["BLOBS"] as const;

export const BODY_DERIVED_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding"
]);

export const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade"
]);

export const FIXTURE_FILE_NAMES = {
  API_REQUEST: "request.json",
  API_META: "response.meta.json"
} as const;

export const STATIC_RESOURCE_MANIFEST_FILE = "RESOURCE_MANIFEST.json";
export const STATIC_RESOURCE_MANIFEST_SCHEMA_VERSION = 1;

export const POPUP_REFRESH_INTERVAL_MS = 1500;

export interface EditorPreset {
  id: string;
  label: string;
  commandTemplate: string;
  urlTemplate?: string;
}

export const EDITOR_PRESETS: EditorPreset[] = [
  { id: "cursor", label: "Cursor", commandTemplate: 'cursor "$DIR"', urlTemplate: "cursor://file/$DIR_URI/" },
  { id: "vscode", label: "VS Code", commandTemplate: 'code "$DIR"', urlTemplate: "vscode://file/$DIR_URI/" },
  { id: "antigravity", label: "Antigravity", commandTemplate: 'antigravity "$DIR"' },
  { id: "windsurf", label: "Windsurf", commandTemplate: 'windsurf "$DIR"' }
];

export const DEFAULT_EDITOR_ID = "cursor";
