import { openAgentDatabase, type AgentDatabase } from "./db.mjs";
import {
  loadAgentEnv,
  type AgentEnvConfig,
  type LoadAgentEnvOptions
} from "./env-config.mjs";
import {
  createAgentGateway,
  type AgentModelProvider,
  type CreateAgentGatewayOptions
} from "./gateway.mjs";
import {
  registerAgentRoutes,
  type AgentHttpDependencies,
  type AgentRouterApp
} from "./http.mjs";

export interface AgentRuntime {
  rootPath: string;
  env: AgentEnvConfig;
  provider: AgentModelProvider | null;
  db: AgentDatabase | null;
  enabled: boolean;
  registerRoutes(
    app: AgentRouterApp,
    overrides?: Partial<AgentHttpDependencies>
  ): void;
  close(): void;
}

export interface CreateAgentRuntimeOptions {
  rootPath: string;
  envOptions?: LoadAgentEnvOptions;
  gatewayOptions?: CreateAgentGatewayOptions;
  dbPath?: string;
}

export async function createAgentRuntime(
  options: CreateAgentRuntimeOptions
): Promise<AgentRuntime> {
  const env = await loadAgentEnv(options.envOptions);
  const provider = createAgentGateway(env, options.gatewayOptions);
  const db = provider
    ? await openAgentDatabase(options.rootPath, {
        ...(options.dbPath ? { dbPath: options.dbPath } : {})
      })
    : null;

  return {
    rootPath: options.rootPath,
    env,
    provider,
    db,
    enabled: Boolean(provider && db),
    registerRoutes(app, overrides = {}) {
      registerAgentRoutes(app, {
        rootPath: options.rootPath,
        env,
        provider,
        db,
        ...overrides
      });
    },
    close() {
      db?.close();
    }
  };
}
