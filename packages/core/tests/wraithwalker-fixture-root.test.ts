import { describe, expect, it } from "vitest";

import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

describe("WraithwalkerFixtureRoot", () => {
  it("creates a fixture root with a customizable sentinel id", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-helper-",
      rootId: "root-helper"
    });

    expect(root.rootId).toBe("root-helper");
    expect(await root.readJson<{ rootId: string }>(".wraithwalker/root.json")).toEqual(
      expect.objectContaining({ rootId: "root-helper" })
    );
  });

  it("builds manifest and fixture paths for simple and advanced layouts", async () => {
    const root = await createWraithwalkerFixtureRoot();

    expect(root.originKey("https://api.example.com:8443")).toBe("https__api.example.com__8443");
    expect(root.scenarioRelativePath("baseline")).toBe(".wraithwalker/scenarios/baseline");
    expect(root.cliConfigRelativePath()).toBe(".wraithwalker/cli.json");
    expect(root.manifestRelativePath({
      topOrigin: "https://app.example.com"
    })).toBe(".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json");
    expect(root.manifestRelativePath({
      topOrigin: "https://app.example.com",
      scenario: "baseline"
    })).toBe(".wraithwalker/scenarios/baseline/.wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json");

    expect(root.apiFixturePaths({
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def"
    })).toEqual({
      fixtureDir: ".wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def",
      metaPath: ".wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def/response.meta.json",
      bodyPath: ".wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def/response.body"
    });

    expect(root.apiFixturePaths({
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      scenario: "candidate",
      method: "POST",
      fixtureName: "orders__q-abc__b-def"
    })).toEqual({
      fixtureDir: ".wraithwalker/scenarios/candidate/.wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/POST/orders__q-abc__b-def",
      metaPath: ".wraithwalker/scenarios/candidate/.wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/POST/orders__q-abc__b-def/response.meta.json",
      bodyPath: ".wraithwalker/scenarios/candidate/.wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/POST/orders__q-abc__b-def/response.body"
    });
  });

  it("writes cli config, manifests, fixtures, scenarios, and arbitrary files", async () => {
    const root = await createWraithwalkerFixtureRoot();

    await root.writeCliConfig({ theme: { overrides: { labelWidth: 16 } } });
    await root.ensureOrigin({
      topOrigin: "https://app.example.com",
      scenario: "baseline"
    });
    await root.writeManifest({
      topOrigin: "https://app.example.com",
      manifest: {
        schemaVersion: 1,
        topOrigin: "https://app.example.com",
        topOriginKey: "https__app.example.com",
        generatedAt: "2026-04-05T00:00:00.000Z",
        resourcesByPathname: {}
      }
    });
    await root.writeApiFixture({
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta: {
        status: 200,
        mimeType: "application/json",
        url: "https://api.example.com/users",
        method: "GET"
      },
      body: "{\"users\":[]}"
    });
    await root.ensureScenario("baseline");
    await root.writeApiFixture({
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      scenario: "baseline",
      method: "POST",
      fixtureName: "orders__q-abc__b-def",
      meta: {
        status: 201,
        mimeType: "application/json",
        url: "https://api.example.com/orders",
        method: "POST"
      }
    });
    await root.writeText("cdn.example.com/assets/app.js", "console.log('fixture');");

    expect(await root.readJson<{ theme: { overrides: { labelWidth: number } } }>(".wraithwalker/cli.json")).toEqual({
      theme: { overrides: { labelWidth: 16 } }
    });
    expect(await root.readJson<{ topOriginKey: string }>(".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json")).toEqual(
      expect.objectContaining({ topOriginKey: "https__app.example.com" })
    );
    expect(await root.readJson<{ status: number }>(".wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def/response.meta.json")).toEqual(
      expect.objectContaining({ status: 200 })
    );
    expect(await root.readJson<{ status: number }>(".wraithwalker/scenarios/baseline/.wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/POST/orders__q-abc__b-def/response.meta.json")).toEqual(
      expect.objectContaining({ status: 201 })
    );
    await expect(root.readJson(".wraithwalker/scenarios/baseline/.wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/POST/orders__q-abc__b-def/response.body")).rejects.toThrow();
    expect(root.resolve("cdn.example.com/assets/app.js")).toContain("cdn.example.com/assets/app.js");
  });
});
