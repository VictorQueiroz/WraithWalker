import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import express from "express";

import { createCanonicalFixtureRoot } from "../../../test-support/canonical-fixture-root.mts";
import { createAgentRuntime, type AgentRuntime } from "../src/runtime.mts";

const runtimes: AgentRuntime[] = [];

afterEach(() => {
  while (runtimes.length > 0) {
    runtimes.pop()?.close();
  }
});

async function writeTempEnv(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ww-agent-runtime-"));
  const envFilePath = path.join(dir, ".env");
  await fs.writeFile(envFilePath, content, "utf-8");
  return envFilePath;
}

describe("createAgentRuntime", () => {
  it("is disabled without an API key", async () => {
    const canonical = await createCanonicalFixtureRoot();
    const runtime = await createAgentRuntime({
      rootPath: canonical.root.rootPath,
      envOptions: {
        env: {},
        envFilePath: path.join(os.tmpdir(), "ww-none", ".env")
      }
    });
    runtimes.push(runtime);

    expect(runtime.enabled).toBe(false);
    expect(runtime.provider).toBeNull();
    expect(runtime.db).toBeNull();
    runtime.close();
  });

  it("enables the agent when the env file provides a key", async () => {
    const canonical = await createCanonicalFixtureRoot();
    const envFilePath = await writeTempEnv("AI_GATEWAY_API_KEY=vck_test");
    const runtime = await createAgentRuntime({
      rootPath: canonical.root.rootPath,
      envOptions: { env: {}, envFilePath },
      dbPath: ":memory:"
    });
    runtimes.push(runtime);

    expect(runtime.enabled).toBe(true);
    expect(runtime.env.model).toBe("deepseek/deepseek-v4-pro");
    expect(runtime.provider?.modelId).toBe("deepseek/deepseek-v4-pro");
    expect(runtime.db).not.toBeNull();
  });

  it("registers working routes on an express app", async () => {
    const canonical = await createCanonicalFixtureRoot();
    const envFilePath = await writeTempEnv("AI_GATEWAY_API_KEY=vck_test");
    const runtime = await createAgentRuntime({
      rootPath: canonical.root.rootPath,
      envOptions: { env: {}, envFilePath },
      dbPath: ":memory:"
    });
    runtimes.push(runtime);

    const app = express();
    runtime.registerRoutes(app);

    const server = await new Promise<import("node:http").Server>((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    try {
      const address = server.address() as { port: number };
      const status = (await (
        await fetch(`http://127.0.0.1:${address.port}/agent/status`)
      ).json()) as Record<string, any>;
      expect(status.enabled).toBe(true);
      expect(status.envFilePath).toBe(envFilePath);
    } finally {
      server.close();
    }
  });
});
