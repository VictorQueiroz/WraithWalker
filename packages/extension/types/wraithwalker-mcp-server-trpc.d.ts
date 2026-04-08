declare module "@wraithwalker/mcp-server/trpc" {
  export interface TrpcSystemInfo {
    serverName: string;
    serverVersion: string;
    rootPath: string;
    sentinel: {
      rootId: string;
      schemaVersion?: number;
      createdAt?: string;
    };
    baseUrl: string;
    mcpUrl: string;
    trpcUrl: string;
  }

  export interface TrpcHeartbeatInfo extends TrpcSystemInfo {
    activeTrace: {
      schemaVersion: number;
      traceId: string;
      name?: string;
      status: "armed" | "recording" | "completed";
      createdAt: string;
      startedAt?: string;
      endedAt?: string;
      rootId: string;
      selectedOrigins: string[];
      extensionClientId: string;
      steps: Array<{
        stepId: string;
        tabId: number;
        recordedAt: string;
        pageUrl: string;
        topOrigin: string;
        selector: string;
        tagName: string;
        textSnippet: string;
        role?: string;
        ariaLabel?: string;
        href?: string;
        linkedFixtures: Array<{
          bodyPath: string;
          requestUrl: string;
          resourceType: string;
          capturedAt: string;
        }>;
      }>;
    } | null;
  }

  export type AppRouter = any;
}
