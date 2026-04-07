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

  export type AppRouter = any;
}
