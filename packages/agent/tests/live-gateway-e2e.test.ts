import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import express from "express";

import { createCanonicalFixtureRoot } from "../../../test-support/canonical-fixture-root.mts";
import { parseEnvFile } from "../src/env-config.mts";
import { createAgentRuntime, type AgentRuntime } from "../src/runtime.mts";

const REPO_ENV_PATH = fileURLToPath(new URL("../../../.env", import.meta.url));

async function readRepoGatewayKey(): Promise<string | null> {
  if (process.env.AI_GATEWAY_API_KEY) {
    return process.env.AI_GATEWAY_API_KEY;
  }

  try {
    const values = parseEnvFile(await fs.readFile(REPO_ENV_PATH, "utf-8"));
    return values.AI_GATEWAY_API_KEY ?? null;
  } catch {
    return null;
  }
}

const gatewayKey = await readRepoGatewayKey();

const servers: Server[] = [];
const runtimes: AgentRuntime[] = [];

afterAll(() => {
  for (const server of servers) {
    server.close();
  }
  for (const runtime of runtimes) {
    runtime.close();
  }
});

describe.runIf(Boolean(gatewayKey))("live AI Gateway end-to-end", () => {
  it(
    "answers a question about captured fixtures using real RAG and DeepSeek",
    { timeout: 180_000 },
    async () => {
      const canonical = await createCanonicalFixtureRoot();
      const runtime = await createAgentRuntime({
        rootPath: canonical.root.rootPath,
        envOptions: {
          env: { AI_GATEWAY_API_KEY: gatewayKey! },
          envFilePath: path.join(canonical.root.rootPath, "no-env-file")
        }
      });
      runtimes.push(runtime);
      expect(runtime.enabled).toBe(true);

      const app = express();
      runtime.registerRoutes(app);
      const server = await new Promise<Server>((resolve) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      });
      servers.push(server);
      const port = (server.address() as { port: number }).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      const response = await fetch(`${baseUrl}/agent/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: "live-e2e-1",
          projectId: "example.com",
          messages: [
            {
              id: "u1",
              role: "user",
              parts: [
                {
                  type: "text",
                  text: "Look at the captured API fixtures. What is the slug of the item returned by the items endpoint? Answer with just the slug."
                }
              ]
            }
          ]
        })
      });

      expect(response.status).toBe(200);
      const streamText = await response.text();
      expect(streamText).toContain("data:");

      const db = runtime.db!;
      const messages = db.listConversationMessages("live-e2e-1");
      expect(messages.length).toBeGreaterThanOrEqual(2);

      const assistantMessage = messages[messages.length - 1];
      expect(assistantMessage.role).toBe("assistant");
      const fullText = JSON.stringify(assistantMessage.parts);
      expect(fullText).toContain("canonical-item");

      const indexState = db.getIndexState("example.com");
      expect(indexState?.status).toBe("ready");
      expect(indexState?.chunkCount).toBeGreaterThan(0);

      const conversation = db.getConversation("live-e2e-1");
      expect(conversation?.title).toContain("captured API fixtures");
    }
  );

  it(
    "streams UIMessage chunks compatible with the useChat client",
    { timeout: 180_000 },
    async () => {
      const canonical = await createCanonicalFixtureRoot();
      const runtime = await createAgentRuntime({
        rootPath: canonical.root.rootPath,
        envOptions: {
          env: { AI_GATEWAY_API_KEY: gatewayKey! },
          envFilePath: path.join(canonical.root.rootPath, "no-env-file")
        }
      });
      runtimes.push(runtime);

      const app = express();
      runtime.registerRoutes(app);
      const server = await new Promise<Server>((resolve) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      });
      servers.push(server);
      const port = (server.address() as { port: number }).port;

      const response = await fetch(`http://127.0.0.1:${port}/agent/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: "live-e2e-2",
          projectId: "example.com",
          messages: [
            {
              id: "u1",
              role: "user",
              parts: [{ type: "text", text: "Say the word ready." }]
            }
          ]
        })
      });

      expect(response.headers.get("content-type")).toContain(
        "text/event-stream"
      );
      const body = await response.text();
      const chunkTypes = [...body.matchAll(/"type":"([a-z-]+)"/g)].map(
        (match) => match[1]
      );
      expect(chunkTypes).toContain("start");
      expect(chunkTypes).toContain("text-delta");
      expect(chunkTypes).toContain("finish");
      expect(body).toContain("[DONE]");
    }
  );
});

describe.runIf(!gatewayKey)("live AI Gateway end-to-end (skipped)", () => {
  it("is skipped because AI_GATEWAY_API_KEY is not available", () => {
    expect(gatewayKey).toBeNull();
  });
});
