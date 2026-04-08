import {
  CAPTURE_HTTP_DIR,
  DEFAULT_CONTEXT_FILES,
  EDITOR_CONTEXT_FILES,
  FIXTURE_FILE_NAMES,
  MANIFESTS_DIR,
  STATIC_RESOURCE_MANIFEST_FILE
} from "./constants.mjs";
import {
  originToKey,
  type FixtureDescriptor,
  type RequestPayload,
  type ResponseMeta,
  type StaticResourceManifest,
  type StoredFixture
} from "./fixture-layout.mjs";
import {
  createFixtureRepository,
  type FixtureRepositoryStorage,
  type FixtureResponsePayload
} from "./fixture-repository.mjs";
import {
  createProjectConfigStore,
  type ProjectConfigFile,
  type ProjectConfigStorage
} from "./project-config-store.mjs";
import type { SiteConfig } from "./site-config.mjs";
import {
  createScenarioTraceStore,
  type ScenarioTraceRecord,
  type ScenarioTraceStorage,
  type ScenarioTraceSummary,
  type ScenarioTraceStep,
  type ScenarioTraceLinkedFixture
} from "./scenario-traces.mjs";
import type { SiteConfigLike } from "./fixtures.mjs";
import type { RootSentinel } from "./root.mjs";
import {
  inferTypeNode,
  mergeTypeNodes,
  pathToInterfaceName,
  renderBarrelFile,
  renderDtsFile,
  type TypeNode
} from "./type-extractor.mjs";

export { EDITOR_CONTEXT_FILES } from "./constants.mjs";

export interface RootRuntimeDirectoryEntry {
  name: string;
  kind: "file" | "directory";
}

export interface RootRuntimeStorage<TRoot> extends FixtureRepositoryStorage<TRoot> {
  ensureSentinel(root: TRoot): Promise<RootSentinel>;
  readText(root: TRoot, relativePath: string): Promise<string>;
  writeText(root: TRoot, relativePath: string, content: string): Promise<void>;
  listDirectory(root: TRoot, relativePath: string): Promise<RootRuntimeDirectoryEntry[]>;
}

export type {
  ScenarioTraceLinkedFixture,
  ScenarioTraceRecord,
  ScenarioTraceStep,
  ScenarioTraceSummary
} from "./scenario-traces.mjs";

interface CreateWraithwalkerRootRuntimeDependencies<TRoot> {
  root: TRoot;
  storage: RootRuntimeStorage<TRoot>;
}

interface ApiEndpointSummary {
  method: string;
  pathname: string;
  status: number;
  mimeType: string;
  responseShape: string | null;
  typeNode: TypeNode | null;
}

interface OriginSummary {
  origin: string;
  originKey: string;
  apiEndpoints: ApiEndpointSummary[];
  staticAssets: Record<string, number>;
  totalStaticAssets: number;
}

interface ContextData {
  generatedAt: string;
  origins: OriginSummary[];
}

export function inferJsonShape(value: unknown, indent = 0): string {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";

  if (Array.isArray(value)) {
    if (value.length === 0) return "unknown[]";
    return `${inferJsonShape(value[0], indent)}[]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";

    const pad = "  ".repeat(indent + 1);
    const closePad = "  ".repeat(indent);
    const lines = entries.map(
      ([key, entryValue]) => `${pad}${key}: ${inferJsonShape(entryValue, indent + 1)}`
    );
    return `{\n${lines.join(";\n")};\n${closePad}}`;
  }

  return "unknown";
}

async function collectApiEndpoints<TRoot>(
  storage: RootRuntimeStorage<TRoot>,
  root: TRoot,
  basePath: string
): Promise<ApiEndpointSummary[]> {
  const endpoints: ApiEndpointSummary[] = [];
  const httpPath = `${basePath}/http`;

  let methods: RootRuntimeDirectoryEntry[];
  try {
    methods = await storage.listDirectory(root, httpPath);
  } catch {
    return endpoints;
  }

  for (const methodEntry of methods) {
    if (methodEntry.kind !== "directory") continue;

    let fixtures: RootRuntimeDirectoryEntry[];
    try {
      fixtures = await storage.listDirectory(root, `${httpPath}/${methodEntry.name}`);
    } catch {
      continue;
    }

    for (const fixtureEntry of fixtures) {
      if (fixtureEntry.kind !== "directory") continue;

      const fixtureDir = `${httpPath}/${methodEntry.name}/${fixtureEntry.name}`;
      const meta = await storage.readOptionalJson<ResponseMeta>(
        root,
        `${fixtureDir}/${FIXTURE_FILE_NAMES.API_META}`
      );
      if (!meta) continue;

      const pathname = meta.url
        ? new URL(meta.url).pathname
        : fixtureEntry.name.replace(/__q-.*/, "").replace(/-/g, "/");

      let responseShape: string | null = null;
      let typeNode: TypeNode | null = null;
      if (meta.mimeType?.includes("json")) {
        try {
          const parsed = JSON.parse(
            await storage.readText(root, `${fixtureDir}/response.body`)
          );
          responseShape = inferJsonShape(parsed);
          typeNode = inferTypeNode(parsed);
        } catch {
          // Response bodies can be missing or invalid JSON.
        }
      }

      endpoints.push({
        method: methodEntry.name,
        pathname,
        status: meta.status,
        mimeType: meta.mimeType || "",
        responseShape,
        typeNode
      });
    }
  }

  return endpoints;
}

function collectStaticAssetSummary(manifest: StaticResourceManifest): {
  byType: Record<string, number>;
  total: number;
} {
  const byType: Record<string, number> = {};
  let total = 0;

  for (const entries of Object.values(manifest.resourcesByPathname)) {
    for (const entry of entries) {
      const type = entry.resourceType || "Other";
      byType[type] = (byType[type] || 0) + 1;
      total++;
    }
  }

  return { byType, total };
}

async function collectOriginSummary<TRoot>(
  storage: RootRuntimeStorage<TRoot>,
  root: TRoot,
  siteConfig: SiteConfigLike
): Promise<OriginSummary> {
  const originKey = originToKey(siteConfig.origin);
  const manifest = await storage.readOptionalJson<StaticResourceManifest>(
    root,
    `${MANIFESTS_DIR}/${originKey}/${STATIC_RESOURCE_MANIFEST_FILE}`
  );
  const { byType, total } = manifest
    ? collectStaticAssetSummary(manifest)
    : { byType: {}, total: 0 };

  const originsPath = `${CAPTURE_HTTP_DIR}/${originKey}/origins`;
  const apiEndpoints = await collectApiEndpoints(
    storage,
    root,
    `${originsPath}/${originKey}`
  );

  try {
    const originDirs = await storage.listDirectory(root, originsPath);
    for (const entry of originDirs) {
      if (entry.kind !== "directory" || entry.name === originKey) continue;
      apiEndpoints.push(
        ...(await collectApiEndpoints(storage, root, `${originsPath}/${entry.name}`))
      );
    }
  } catch {
    // The origin tree can be absent for roots with only static assets.
  }

  return {
    origin: siteConfig.origin,
    originKey,
    apiEndpoints,
    staticAssets: byType,
    totalStaticAssets: total
  };
}

function renderContextMarkdown(data: ContextData): string {
  const lines: string[] = [];
  const originList = data.origins.map((origin) => origin.origin).join(", ");

  lines.push("# WraithWalker Fixture Context");
  lines.push("");
  lines.push(`Generated: ${data.generatedAt}`);
  lines.push("");
  lines.push("This file describes the captured network fixtures in this directory.");
  lines.push("It is auto-generated when you open the fixture root in Cursor.");
  lines.push("");
  lines.push("## Cursor Agent Brief");
  lines.push("");
  lines.push("This root folder is a WraithWalker fixture workspace, not the source repository for the site.");
  lines.push("It contains dumped assets, static resource manifests, API fixtures, and replay metadata for the selected origins.");
  lines.push(originList ? `Selected origins: ${originList}` : "Selected origins: none yet.");
  lines.push("");
  lines.push("When working in this root:");
  lines.push("");
  lines.push("- Prettify minified or dumped contents before reasoning about them.");
  lines.push("- Start by understanding the structure of the website across the selected origins below.");
  lines.push("- Use RESOURCE_MANIFEST.json files, sidecar metadata, and API fixtures to map how requests and assets fit together.");
  lines.push("- Treat captured files as fixture data unless the task is explicitly to rewrite or replace them.");
  lines.push("");

  for (const origin of data.origins) {
    lines.push(`## ${origin.origin}`);
    lines.push("");

    if (origin.apiEndpoints.length > 0) {
      lines.push("### API Endpoints");
      lines.push("");
      lines.push("| Method | Path | Status | Content Type |");
      lines.push("|--------|------|--------|--------------|");
      for (const endpoint of origin.apiEndpoints) {
        lines.push(`| ${endpoint.method} | ${endpoint.pathname} | ${endpoint.status} | ${endpoint.mimeType} |`);
      }
      lines.push("");

      const jsonEndpoints = origin.apiEndpoints.filter((endpoint) => endpoint.responseShape);
      if (jsonEndpoints.length > 0) {
        lines.push("### Response Shapes");
        lines.push("");
        for (const endpoint of jsonEndpoints) {
          lines.push(`#### ${endpoint.method} ${endpoint.pathname} (${endpoint.status})`);
          lines.push("");
          lines.push("```typescript");
          lines.push(endpoint.responseShape!);
          lines.push("```");
          lines.push("");
        }
      }
    }

    if (origin.totalStaticAssets > 0) {
      lines.push("### Static Assets");
      lines.push("");
      const parts = Object.entries(origin.staticAssets)
        .sort(([, left], [, right]) => right - left)
        .map(([type, count]) => `${type}: ${count}`);
      lines.push(parts.join(" | "));
      lines.push("");
    }

    if (origin.apiEndpoints.length === 0 && origin.totalStaticAssets === 0) {
      lines.push("No captured fixtures found for this origin.");
      lines.push("");
    }
  }

  if (data.origins.some((origin) => origin.apiEndpoints.length > 0)) {
    lines.push("## Suggested Agent Tasks");
    lines.push("");
    const firstApiOrigin = data.origins.find((origin) => origin.apiEndpoints.length > 0);
    if (firstApiOrigin) {
      const endpoint = firstApiOrigin.apiEndpoints[0];
      lines.push(`- Modify the \`${endpoint.method} ${endpoint.pathname}\` fixture to return an error status and test error handling`);
      lines.push(`- Change response data in \`${endpoint.method} ${endpoint.pathname}\` to test edge cases (empty arrays, null fields, large payloads)`);
    }
    lines.push("- Add new fixture files for endpoints that don't exist yet to support offline development");
    lines.push("- Generate TypeScript interfaces from the response shapes above");
    lines.push("");
  }

  return lines.join("\n");
}

async function generateTypes<TRoot>(
  storage: RootRuntimeStorage<TRoot>,
  root: TRoot,
  data: ContextData
): Promise<void> {
  const moduleNames: string[] = [];

  for (const origin of data.origins) {
    const typedEndpoints = origin.apiEndpoints.filter((endpoint) => endpoint.typeNode !== null);
    if (typedEndpoints.length === 0) continue;

    const declarations = new Map<string, { name: string; node: TypeNode }>();
    for (const endpoint of typedEndpoints) {
      const interfaceName = pathToInterfaceName(endpoint.method, endpoint.pathname);
      const existing = declarations.get(interfaceName);
      if (existing && endpoint.typeNode) {
        existing.node = mergeTypeNodes(existing.node, endpoint.typeNode);
      } else if (endpoint.typeNode) {
        declarations.set(interfaceName, { name: interfaceName, node: endpoint.typeNode });
      }
    }

    await storage.writeText(
      root,
      `.wraithwalker/types/${origin.originKey}.d.ts`,
      renderDtsFile([...declarations.values()])
    );
    moduleNames.push(origin.originKey);
  }

  if (moduleNames.length > 0) {
    await storage.writeText(
      root,
      ".wraithwalker/types/index.d.ts",
      renderBarrelFile(moduleNames)
    );
  }
}

export function createWraithwalkerRootRuntime<TRoot>({
  root,
  storage
}: CreateWraithwalkerRootRuntimeDependencies<TRoot>) {
  let sentinelPromise: Promise<RootSentinel> | null = null;

  function ensureReady(): Promise<RootSentinel> {
    sentinelPromise ??= storage.ensureSentinel(root);
    return sentinelPromise;
  }

  async function createRepository() {
    return createFixtureRepository({
      root,
      sentinel: await ensureReady(),
      storage
    });
  }

  const scenarioTraceStore = createScenarioTraceStore({
    root,
    storage: storage as ScenarioTraceStorage<TRoot>,
    ensureReady
  });
  const projectConfigStore = createProjectConfigStore({
    root,
    storage: storage as ProjectConfigStorage<TRoot>
  });

  async function has(descriptor: FixtureDescriptor): Promise<boolean> {
    return (await createRepository()).exists(descriptor);
  }

  async function read(descriptor: FixtureDescriptor): Promise<StoredFixture | null> {
    return (await createRepository()).read(descriptor);
  }

  async function writeIfAbsent(payload: {
    descriptor: FixtureDescriptor;
    request: RequestPayload;
    response: FixtureResponsePayload;
  }) {
    return (await createRepository()).writeIfAbsent(payload);
  }

  async function generateContext({
    siteConfigs,
    editorId
  }: {
    siteConfigs: SiteConfigLike[];
    editorId?: string;
  }): Promise<string> {
    await ensureReady();

    const origins: OriginSummary[] = [];
    for (const siteConfig of siteConfigs) {
      origins.push(await collectOriginSummary(storage, root, siteConfig));
    }

    const data: ContextData = {
      generatedAt: new Date().toISOString(),
      origins
    };
    const markdown = renderContextMarkdown(data);
    const fileNames = EDITOR_CONTEXT_FILES[editorId || ""] || DEFAULT_CONTEXT_FILES;

    for (const fileName of fileNames) {
      await storage.writeText(root, fileName, markdown);
    }

    await generateTypes(storage, root, data);
    return markdown;
  }

  return {
    ensureReady,
    has,
    read,
    writeIfAbsent,
    readProjectConfig: projectConfigStore.readProjectConfig as () => Promise<ProjectConfigFile>,
    writeProjectConfig: projectConfigStore.writeProjectConfig as (config: ProjectConfigFile) => Promise<ProjectConfigFile>,
    readConfiguredSiteConfigs: projectConfigStore.readConfiguredSiteConfigs as () => Promise<SiteConfig[]>,
    writeConfiguredSiteConfigs: projectConfigStore.writeConfiguredSiteConfigs as (siteConfigs: SiteConfig[]) => Promise<ProjectConfigFile>,
    resolveConfiguredSite: projectConfigStore.resolveConfiguredSite as (origin: string) => Promise<SiteConfig | null>,
    readEffectiveSiteConfigs: projectConfigStore.readEffectiveSiteConfigs as () => Promise<SiteConfig[]>,
    generateContext,
    getActiveTrace: scenarioTraceStore.getActiveTrace,
    listTraces: scenarioTraceStore.listTraces,
    readTrace: scenarioTraceStore.readTrace,
    startTrace: scenarioTraceStore.startTrace,
    stopTrace: scenarioTraceStore.stopTrace,
    recordClick: scenarioTraceStore.recordClick,
    linkFixture: scenarioTraceStore.linkFixture
  };
}
