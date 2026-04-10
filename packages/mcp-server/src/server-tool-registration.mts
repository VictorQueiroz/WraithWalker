import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { type createExtensionSessionTracker } from "./extension-session.mjs";
import { SERVER_NAME, SERVER_VERSION } from "./server-constants.mjs";
import { type createServerRootRuntime } from "./root-runtime.mjs";
import { registerBrowserTools } from "./server-tools-browser.mjs";
import { registerFixtureTools } from "./server-tools-fixtures.mjs";
import { registerSiteConfigTools } from "./server-tools-site-config.mjs";
import { registerSnapshotTools } from "./server-tools-snapshots.mjs";
import { registerTraceTools } from "./server-tools-traces.mjs";

export function registerTools(
  server: McpServer,
  rootPath: string,
  {
    runtime,
    extensionSessions
  }: {
    runtime: ReturnType<typeof createServerRootRuntime>;
    extensionSessions: ReturnType<typeof createExtensionSessionTracker>;
  }
): void {
  registerBrowserTools(server, { extensionSessions });
  registerTraceTools(server, { runtime, extensionSessions });
  registerSiteConfigTools(server, { runtime, extensionSessions });
  registerFixtureTools(server, rootPath, { runtime });
  registerSnapshotTools(server, rootPath);
}

export function createConnectedServer(
  rootPath: string,
  {
    runtime,
    extensionSessions
  }: {
    runtime: ReturnType<typeof createServerRootRuntime>;
    extensionSessions: ReturnType<typeof createExtensionSessionTracker>;
  }
): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });
  registerTools(server, rootPath, { runtime, extensionSessions });
  return server;
}
