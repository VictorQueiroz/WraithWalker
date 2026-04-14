export const SERVER_NAME = "wraithwalker";
export const SERVER_VERSION = "0.6.1";

export const HTTP_MCP_PATH = "/mcp";
export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 4319;
export const DEFAULT_HTTP_TRPC_MAX_BODY_SIZE_BYTES = 25 * 1024 * 1024;

export const MCP_TOOL_NAMES = [
  "browser-status",
  "read-console",
  "trace-status",
  "start-trace",
  "stop-trace",
  "list-traces",
  "read-trace",
  "list-configured-sites",
  "whitelist-site",
  "remove-site",
  "update-site-patterns",
  "prepare-site-for-capture",
  "list-sites",
  "list-files",
  "list-api-routes",
  "search-files",
  "read-api-response",
  "read-file",
  "read-file-snippet",
  "read-site-manifest",
  "write-file",
  "patch-file",
  "restore-file",
  "checkout-workspace",
  "push-workspace",
  "discard-workspace",
  "list-snapshots",
  "save-trace-as-snapshot",
  "diff-snapshots"
] as const;
