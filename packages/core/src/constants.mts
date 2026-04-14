export const ROOT_SENTINEL_RELATIVE_PATH = ".wraithwalker/root.json";
export const ROOT_SENTINEL_SCHEMA_VERSION = 1;
export const PROJECT_CONFIG_RELATIVE_PATH = ".wraithwalker/config.json";
export const PROJECT_CONFIG_SCHEMA_VERSION = 1;
export const WRAITHWALKER_DIR = ".wraithwalker";
export const CAPTURES_DIR = `${WRAITHWALKER_DIR}/captures`;
export const CAPTURE_ASSETS_DIR = `${CAPTURES_DIR}/assets`;
export const CAPTURE_HTTP_DIR = `${CAPTURES_DIR}/http`;
export const MANIFESTS_DIR = `${WRAITHWALKER_DIR}/manifests`;
export const SCENARIOS_DIR = ".wraithwalker/scenarios";
export const SCENARIO_ACTIVE_FILE = `${SCENARIOS_DIR}/active.json`;
export const SCENARIO_ACTIVE_SCHEMA_VERSION = 1;
export const SCENARIO_METADATA_FILE = "scenario.json";
export const SCENARIO_METADATA_SCHEMA_VERSION = 1;
export const SCENARIO_TRACES_DIR = ".wraithwalker/scenario-traces";
export const SCENARIO_TRACE_ACTIVE_FILE = `${SCENARIO_TRACES_DIR}/active.json`;
export const SCENARIO_TRACE_SCHEMA_VERSION = 2;
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
