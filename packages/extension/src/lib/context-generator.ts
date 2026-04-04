import {
  FIXTURE_FILE_NAMES,
  SIMPLE_MODE_METADATA_DIR,
  SIMPLE_MODE_METADATA_TREE,
  STATIC_RESOURCE_MANIFEST_FILE
} from "./constants.js";
import { originToKey } from "./path-utils.js";
import {
  inferTypeNode,
  mergeTypeNodes,
  pathToInterfaceName,
  renderBarrelFile,
  renderDtsFile,
  type TypeNode
} from "./type-extractor.js";
import type { ResponseMeta, SiteConfig, StaticResourceManifest } from "./types.js";

interface GatewayLike {
  exists(rootHandle: FileSystemDirectoryHandle, relativePath: string): Promise<boolean>;
  readJson<T>(rootHandle: FileSystemDirectoryHandle, relativePath: string): Promise<T>;
  readOptionalJson<T>(rootHandle: FileSystemDirectoryHandle, relativePath: string): Promise<T | null>;
  readText(rootHandle: FileSystemDirectoryHandle, relativePath: string): Promise<string>;
  writeJson(rootHandle: FileSystemDirectoryHandle, relativePath: string, value: unknown): Promise<void>;
  listDirectory(rootHandle: FileSystemDirectoryHandle, relativePath: string): Promise<Array<{ name: string; kind: "file" | "directory" }>>;
}

interface ContextGeneratorDependencies {
  rootHandle: FileSystemDirectoryHandle;
  gateway: GatewayLike;
  siteConfigs: SiteConfig[];
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
    const elementShape = inferJsonShape(value[0], indent);
    return `${elementShape}[]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const pad = "  ".repeat(indent + 1);
    const closePad = "  ".repeat(indent);
    const lines = entries.map(
      ([key, val]) => `${pad}${key}: ${inferJsonShape(val, indent + 1)}`
    );
    return `{\n${lines.join(";\n")};\n${closePad}}`;
  }

  return "unknown";
}

async function collectApiEndpoints(
  gateway: GatewayLike,
  rootHandle: FileSystemDirectoryHandle,
  basePath: string
): Promise<ApiEndpointSummary[]> {
  const endpoints: ApiEndpointSummary[] = [];

  const httpPath = `${basePath}/http`;

  let methods: Array<{ name: string; kind: string }>;
  try {
    methods = await gateway.listDirectory(rootHandle, httpPath);
  } catch {
    return endpoints;
  }

  for (const methodEntry of methods) {
    if (methodEntry.kind !== "directory") continue;
    const method = methodEntry.name;

    let fixtures: Array<{ name: string; kind: string }>;
    try {
      fixtures = await gateway.listDirectory(rootHandle, `${httpPath}/${method}`);
    } catch {
      continue;
    }

    for (const fixtureEntry of fixtures) {
      if (fixtureEntry.kind !== "directory") continue;
      const fixtureDir = `${httpPath}/${method}/${fixtureEntry.name}`;
      const metaPath = `${fixtureDir}/${FIXTURE_FILE_NAMES.API_META}`;

      const meta = await gateway.readOptionalJson<ResponseMeta>(rootHandle, metaPath);
      if (!meta) continue;

      const pathname = meta.url ? new URL(meta.url).pathname : fixtureEntry.name.replace(/__q-.*/, "").replace(/-/g, "/");

      let responseShape: string | null = null;
      let typeNode: TypeNode | null = null;
      if (meta.mimeType?.includes("json")) {
        try {
          const bodyText = await gateway.readText(rootHandle, `${fixtureDir}/response.body`);
          const parsed = JSON.parse(bodyText);
          responseShape = inferJsonShape(parsed);
          typeNode = inferTypeNode(parsed);
        } catch {
          // Body might not be JSON-parseable
        }
      }

      endpoints.push({
        method,
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

function collectStaticAssetSummary(manifest: StaticResourceManifest): { byType: Record<string, number>; total: number } {
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

async function collectOriginSummary(
  gateway: GatewayLike,
  rootHandle: FileSystemDirectoryHandle,
  siteConfig: SiteConfig
): Promise<OriginSummary> {
  const originKey = originToKey(siteConfig.origin);
  const isSimple = siteConfig.mode === "simple";

  // Read manifest
  const manifestPath = isSimple
    ? `${SIMPLE_MODE_METADATA_DIR}/${SIMPLE_MODE_METADATA_TREE}/${originKey}/${STATIC_RESOURCE_MANIFEST_FILE}`
    : `${originKey}/${STATIC_RESOURCE_MANIFEST_FILE}`;

  const manifest = await gateway.readOptionalJson<StaticResourceManifest>(rootHandle, manifestPath);
  const { byType, total } = manifest ? collectStaticAssetSummary(manifest) : { byType: {}, total: 0 };

  // Collect API endpoints
  const apiBasePath = isSimple
    ? `${SIMPLE_MODE_METADATA_DIR}/${SIMPLE_MODE_METADATA_TREE}/${originKey}/origins/${originKey}`
    : `${originKey}/origins/${originKey}`;

  const apiEndpoints = await collectApiEndpoints(gateway, rootHandle, apiBasePath);

  // Also check cross-origin API endpoints
  const originsPath = isSimple
    ? `${SIMPLE_MODE_METADATA_DIR}/${SIMPLE_MODE_METADATA_TREE}/${originKey}/origins`
    : `${originKey}/origins`;

  try {
    const originDirs = await gateway.listDirectory(rootHandle, originsPath);
    for (const dir of originDirs) {
      if (dir.kind !== "directory" || dir.name === originKey) continue;
      const crossOriginEndpoints = await collectApiEndpoints(
        gateway,
        rootHandle,
        `${originsPath}/${dir.name}`
      );
      apiEndpoints.push(...crossOriginEndpoints);
    }
  } catch {
    // Origins directory may not exist
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

  lines.push("# WraithWalker Fixture Context");
  lines.push("");
  lines.push(`Generated: ${data.generatedAt}`);
  lines.push("");
  lines.push("This file describes the captured network fixtures in this directory.");
  lines.push("It is auto-generated when you open the fixture root in an editor.");
  lines.push("");

  for (const origin of data.origins) {
    lines.push(`## ${origin.origin}`);
    lines.push("");

    if (origin.apiEndpoints.length > 0) {
      lines.push("### API Endpoints");
      lines.push("");
      lines.push("| Method | Path | Status | Content Type |");
      lines.push("|--------|------|--------|--------------|");
      for (const ep of origin.apiEndpoints) {
        lines.push(`| ${ep.method} | ${ep.pathname} | ${ep.status} | ${ep.mimeType} |`);
      }
      lines.push("");

      const jsonEndpoints = origin.apiEndpoints.filter((ep) => ep.responseShape);
      if (jsonEndpoints.length > 0) {
        lines.push("### Response Shapes");
        lines.push("");
        for (const ep of jsonEndpoints) {
          lines.push(`#### ${ep.method} ${ep.pathname} (${ep.status})`);
          lines.push("");
          lines.push("```typescript");
          lines.push(ep.responseShape!);
          lines.push("```");
          lines.push("");
        }
      }
    }

    if (origin.totalStaticAssets > 0) {
      lines.push("### Static Assets");
      lines.push("");
      const parts = Object.entries(origin.staticAssets)
        .sort(([, a], [, b]) => b - a)
        .map(([type, count]) => `${type}: ${count}`);
      lines.push(parts.join(" | "));
      lines.push("");
    }

    if (origin.apiEndpoints.length === 0 && origin.totalStaticAssets === 0) {
      lines.push("No captured fixtures found for this origin.");
      lines.push("");
    }
  }

  if (data.origins.some((o) => o.apiEndpoints.length > 0)) {
    lines.push("## Suggested Agent Tasks");
    lines.push("");
    const firstApi = data.origins.find((o) => o.apiEndpoints.length > 0);
    if (firstApi) {
      const ep = firstApi.apiEndpoints[0];
      lines.push(`- Modify the \`${ep.method} ${ep.pathname}\` fixture to return an error status and test error handling`);
      lines.push(`- Change response data in \`${ep.method} ${ep.pathname}\` to test edge cases (empty arrays, null fields, large payloads)`);
    }
    lines.push("- Add new fixture files for endpoints that don't exist yet to support offline development");
    lines.push("- Generate TypeScript interfaces from the response shapes above");
    lines.push("");
  }

  return lines.join("\n");
}

export const EDITOR_CONTEXT_FILES: Record<string, string[]> = {
  cursor: ["CLAUDE.md", ".cursorrules"],
  antigravity: ["CLAUDE.md"],
  vscode: ["CLAUDE.md"],
  windsurf: ["CLAUDE.md", ".windsurfrules"]
};

const DEFAULT_CONTEXT_FILES = ["CLAUDE.md"];

export function createContextGenerator({ rootHandle, gateway, siteConfigs }: ContextGeneratorDependencies) {
  async function generate(editorId?: string): Promise<string> {
    const origins: OriginSummary[] = [];
    for (const siteConfig of siteConfigs) {
      origins.push(await collectOriginSummary(gateway, rootHandle, siteConfig));
    }

    const data: ContextData = {
      generatedAt: new Date().toISOString(),
      origins
    };

    const markdown = renderContextMarkdown(data);
    const fileNames = EDITOR_CONTEXT_FILES[editorId || ""] || DEFAULT_CONTEXT_FILES;

    for (const fileName of fileNames) {
      const parts = fileName.split("/").filter(Boolean);
      const name = parts.pop()!;
      let dir = rootHandle;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      const fileHandle = await dir.getFileHandle(name, { create: true });
      const writer = await fileHandle.createWritable();
      await writer.write(markdown);
      await writer.close();
    }

    // Generate .d.ts files from API response shapes
    await generateTypes(data);

    return markdown;
  }

  async function writeTextFile(relativePath: string, content: string): Promise<void> {
    const parts = relativePath.split("/").filter(Boolean);
    const name = parts.pop()!;
    let dir = rootHandle;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const fileHandle = await dir.getFileHandle(name, { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write(content);
    await writer.close();
  }

  async function generateTypes(data: ContextData): Promise<void> {
    const moduleNames: string[] = [];

    for (const origin of data.origins) {
      const typedEndpoints = origin.apiEndpoints.filter((ep) => ep.typeNode !== null);
      if (typedEndpoints.length === 0) continue;

      // Merge endpoints with the same method+pathname
      const byKey = new Map<string, { name: string; node: TypeNode }>();
      for (const ep of typedEndpoints) {
        const interfaceName = pathToInterfaceName(ep.method, ep.pathname);
        const existing = byKey.get(interfaceName);
        if (existing && ep.typeNode) {
          existing.node = mergeTypeNodes(existing.node, ep.typeNode);
        } else if (ep.typeNode) {
          byKey.set(interfaceName, { name: interfaceName, node: ep.typeNode });
        }
      }

      const declarations = [...byKey.values()];
      const moduleName = origin.originKey;
      const dtsContent = renderDtsFile(declarations);
      await writeTextFile(`.wraithwalker/types/${moduleName}.d.ts`, dtsContent);
      moduleNames.push(moduleName);
    }

    if (moduleNames.length > 0) {
      await writeTextFile(".wraithwalker/types/index.d.ts", renderBarrelFile(moduleNames));
    }
  }

  return { generate };
}
