import { describe, expect, it } from "vitest";

import { createCanonicalFixtureRoot } from "../../../test-support/canonical-fixture-root.mts";
import { openAgentDatabase } from "../src/db.mts";
import { getAgentProject } from "../src/projects.mts";
import {
  MAX_TOOL_OUTPUT_CHARS,
  boundToolText,
  createAgentTools
} from "../src/tools.mts";
import { createFakeProvider } from "./test-helpers.mts";

const callOptions = { toolCallId: "call-1", messages: [] } as never;

async function createToolsSetup() {
  const canonical = await createCanonicalFixtureRoot();
  const rootPath = canonical.root.rootPath;
  const db = await openAgentDatabase(rootPath, { dbPath: ":memory:" });
  const provider = createFakeProvider();
  const project = (await getAgentProject(rootPath, "example.com"))!;
  const tools = createAgentTools({ rootPath, db, provider, project });
  return { canonical, rootPath, db, provider, project, tools };
}

type ExecutableTool = {
  execute: (input: unknown, options: unknown) => Promise<unknown>;
};

function executable(tools: Record<string, unknown>, name: string) {
  return tools[name] as ExecutableTool;
}

describe("boundToolText", () => {
  it("passes short text through", () => {
    expect(boundToolText("ok")).toBe("ok");
  });

  it("truncates long output with visible metadata", () => {
    const bounded = boundToolText("y".repeat(MAX_TOOL_OUTPUT_CHARS + 123));
    expect(bounded).toContain("[output truncated: 123 of");
  });
});

describe("createAgentTools", () => {
  it("search_captures indexes lazily and returns ranked chunks", async () => {
    const { tools, db } = await createToolsSetup();
    const output = (await executable(tools, "search_captures").execute(
      { query: "catalog items endpoint" },
      callOptions
    )) as string;

    expect(db.getIndexState("example.com")?.status).toBe("ready");
    expect(output).toContain("score");
    expect(output).toContain("api");
  });

  it("search_captures explains when nothing matches", async () => {
    const { tools } = await createToolsSetup();
    const output = (await executable(tools, "search_captures").execute(
      { query: "zzzz" },
      callOptions
    )) as string;
    expect(typeof output).toBe("string");
  });

  it("list_api_endpoints lists captured endpoints and filters", async () => {
    const { tools } = await createToolsSetup();
    const output = (await executable(tools, "list_api_endpoints").execute(
      {},
      callOptions
    )) as string;
    expect(output).toContain("GET /v1/items");
    expect(output).toContain("200");

    const filtered = (await executable(tools, "list_api_endpoints").execute(
      { pathContains: "/nope" },
      callOptions
    )) as string;
    expect(filtered).toContain("No captured API endpoints");
  });

  it("read_api_fixture reads a bounded body page", async () => {
    const { tools, project, rootPath } = await createToolsSetup();
    const { listApiEndpoints } = await import("@wraithwalker/core/fixtures");
    const endpoints = await listApiEndpoints(
      rootPath,
      project.origins.map((origin) => ({ origin: origin.origin }))
    );
    const fixtureDir = endpoints.items[0].fixtureDir;

    const output = (await executable(tools, "read_api_fixture").execute(
      { fixtureDir },
      callOptions
    )) as string;
    expect(output).toContain("GET https://api.example.com/v1/items");
    expect(output).toContain("canonical-item");
    expect(output).toContain("bytes 0-");
  });

  it("read_api_fixture reports missing fixtures", async () => {
    const { tools } = await createToolsSetup();
    const output = (await executable(tools, "read_api_fixture").execute(
      { fixtureDir: ".wraithwalker/captures/http/missing" },
      callOptions
    )) as string;
    expect(output).toContain("Fixture not found");
  });

  it("search_fixture_text finds literal strings in fixture bodies", async () => {
    const { tools } = await createToolsSetup();
    const output = (await executable(tools, "search_fixture_text").execute(
      { query: "canonical-item" },
      callOptions
    )) as string;
    expect(output).toContain("canonical-item");

    const miss = (await executable(tools, "search_fixture_text").execute(
      { query: "definitely-not-present-string" },
      callOptions
    )) as string;
    expect(miss).toContain("No fixture content matched");
  });

  it("get_project_overview summarizes the project", async () => {
    const { tools, project } = await createToolsSetup();
    project.tabLinks.push({
      origin: "https://cdn.thirdparty.net",
      pageUrl: "https://app.example.com/x",
      tabId: 1
    });

    const output = (await executable(tools, "get_project_overview").execute(
      {},
      callOptions
    )) as string;
    expect(output).toContain("*.example.com");
    expect(output).toContain("https://app.example.com");
    expect(output).toContain("tab link: https://cdn.thirdparty.net");
  });
});
