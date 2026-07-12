import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_AGENT_EMBEDDING_MODEL,
  DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_REASONING_EFFORT,
  loadAgentEnv,
  parseEnvFile,
  resolveAgentEnvFilePath
} from "../src/env-config.mts";

describe("resolveAgentEnvFilePath", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    expect(
      resolveAgentEnvFilePath({ XDG_CONFIG_HOME: "/custom/config" }, "/home/u")
    ).toBe(path.join("/custom/config", "wraithwalker", ".env"));
  });

  it("falls back to ~/.config", () => {
    expect(resolveAgentEnvFilePath({}, "/home/u")).toBe(
      path.join("/home/u", ".config", "wraithwalker", ".env")
    );
  });

  it("ignores empty XDG_CONFIG_HOME", () => {
    expect(resolveAgentEnvFilePath({ XDG_CONFIG_HOME: "  " }, "/home/u")).toBe(
      path.join("/home/u", ".config", "wraithwalker", ".env")
    );
  });

  it("defaults to the process env and home dir", () => {
    expect(resolveAgentEnvFilePath()).toContain("wraithwalker");
  });
});

describe("parseEnvFile", () => {
  it("parses simple KEY=VALUE pairs", () => {
    expect(parseEnvFile("A=1\nB=two")).toEqual({ A: "1", B: "two" });
  });

  it("ignores comments, blanks, and malformed lines", () => {
    expect(parseEnvFile("# comment\n\n=nokey\nnoequals\nA=1")).toEqual({
      A: "1"
    });
  });

  it("supports export prefix and quoted values", () => {
    expect(parseEnvFile("export A=\"quoted value\"\nB='single'")).toEqual({
      A: "quoted value",
      B: "single"
    });
  });

  it("rejects invalid identifiers", () => {
    expect(parseEnvFile("1BAD=x\nGOOD=y")).toEqual({ GOOD: "y" });
  });
});

describe("loadAgentEnv", () => {
  async function writeTempEnv(content: string): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ww-agent-env-"));
    const envFilePath = path.join(dir, ".env");
    await fs.writeFile(envFilePath, content, "utf-8");
    return envFilePath;
  }

  it("loads values from the env file", async () => {
    const envFilePath = await writeTempEnv(
      [
        "AI_GATEWAY_API_KEY=file-key",
        "WRAITHWALKER_AI_MODEL=custom/model",
        "WRAITHWALKER_AI_EMBEDDING_MODEL=custom/embed",
        "WRAITHWALKER_AI_REASONING=low"
      ].join("\n")
    );

    const config = await loadAgentEnv({ env: {}, envFilePath });
    expect(config).toMatchObject({
      apiKey: "file-key",
      model: "custom/model",
      embeddingModel: "custom/embed",
      reasoningEffort: "low",
      envFilePath,
      loadedFromFile: true
    });
  });

  it("lets process env override the file", async () => {
    const envFilePath = await writeTempEnv("AI_GATEWAY_API_KEY=file-key");
    const config = await loadAgentEnv({
      env: { AI_GATEWAY_API_KEY: "process-key" },
      envFilePath
    });
    expect(config.apiKey).toBe("process-key");
  });

  it("returns defaults when the file is missing", async () => {
    const config = await loadAgentEnv({
      env: {},
      envFilePath: path.join(os.tmpdir(), "ww-missing", ".env")
    });
    expect(config).toMatchObject({
      apiKey: null,
      model: DEFAULT_AGENT_MODEL,
      embeddingModel: DEFAULT_AGENT_EMBEDDING_MODEL,
      reasoningEffort: DEFAULT_AGENT_REASONING_EFFORT,
      loadedFromFile: false
    });
  });

  it("normalizes invalid reasoning efforts to the default", async () => {
    const envFilePath = await writeTempEnv("WRAITHWALKER_AI_REASONING=absurd");
    const config = await loadAgentEnv({ env: {}, envFilePath });
    expect(config.reasoningEffort).toBe(DEFAULT_AGENT_REASONING_EFFORT);
  });

  it("treats empty values as unset", async () => {
    const envFilePath = await writeTempEnv("AI_GATEWAY_API_KEY=");
    const config = await loadAgentEnv({
      env: { AI_GATEWAY_API_KEY: "" },
      envFilePath
    });
    expect(config.apiKey).toBeNull();
  });
});
