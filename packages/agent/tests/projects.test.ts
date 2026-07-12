import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createCanonicalFixtureRoot } from "../../../test-support/canonical-fixture-root.mts";
import { getAgentProject, listAgentProjects } from "../src/projects.mts";

async function writeTrace(rootPath: string, traceId: string, record: unknown) {
  const traceDir = path.join(
    rootPath,
    ".wraithwalker/scenario-traces",
    traceId
  );
  await fs.mkdir(traceDir, { recursive: true });
  await fs.writeFile(
    path.join(traceDir, "trace.json"),
    JSON.stringify(record),
    "utf-8"
  );
}

describe("listAgentProjects", () => {
  it("groups captured origins by registrable domain with connected origins", async () => {
    const canonical = await createCanonicalFixtureRoot();
    const projects = await listAgentProjects(canonical.root.rootPath);

    expect(projects).toHaveLength(1);
    const project = projects[0];
    expect(project.id).toBe("example.com");
    expect(project.displayName).toBe("*.example.com");
    expect(project.origins.map((origin) => origin.origin)).toEqual([
      "https://app.example.com"
    ]);
    expect(project.apiFixtureCount).toBe(1);
    expect(project.assetCount).toBe(1);
    expect(project.connectedOrigins).toEqual(["https://api.example.com"]);
    expect(project.traceStepCount).toBe(0);
  });

  it("connects third-party origins observed in trace tab captures", async () => {
    const canonical = await createCanonicalFixtureRoot();
    await writeTrace(canonical.root.rootPath, "trace-1", {
      steps: [
        {
          stepId: "s1",
          tabId: 7,
          pageUrl: "https://app.example.com/dashboard",
          linkedFixtures: [
            { requestUrl: "https://cdn.thirdparty.net/lib.js" },
            { requestUrl: "https://api.example.com/v1/items" },
            { requestUrl: "not-a-url" }
          ]
        },
        {
          stepId: "s2",
          tabId: 7,
          pageUrl: "https://unrelated.org/page",
          linkedFixtures: [{ requestUrl: "https://x.io/a" }]
        }
      ]
    });
    await writeTrace(canonical.root.rootPath, "trace-broken", {
      steps: "nope"
    });

    const projects = await listAgentProjects(canonical.root.rootPath);
    const project = projects.find((entry) => entry.id === "example.com")!;

    expect(project.traceStepCount).toBe(1);
    expect(project.connectedOrigins).toContain("https://cdn.thirdparty.net");
    expect(project.connectedOrigins).toContain("https://api.example.com");
    expect(project.tabLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: "https://cdn.thirdparty.net",
          pageUrl: "https://app.example.com/dashboard",
          tabId: 7
        })
      ])
    );
  });

  it("returns an empty list for a root without site configs", async () => {
    const dir = await fs.mkdtemp(path.join("/tmp", "ww-empty-root-"));
    expect(await listAgentProjects(dir)).toEqual([]);
  });
});

describe("getAgentProject", () => {
  it("finds a project by id", async () => {
    const canonical = await createCanonicalFixtureRoot();
    const project = await getAgentProject(
      canonical.root.rootPath,
      "example.com"
    );
    expect(project?.id).toBe("example.com");
    expect(
      await getAgentProject(canonical.root.rootPath, "missing.com")
    ).toBeNull();
  });
});
