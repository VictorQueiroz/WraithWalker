import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  CAPTURE_HTTP_DIR,
  MANIFESTS_DIR,
  PROJECT_CONFIG_RELATIVE_PATH,
  ROOT_SENTINEL_RELATIVE_PATH,
  SCENARIOS_DIR,
  STATIC_RESOURCE_MANIFEST_FILE,
  WRAITHWALKER_DIR
} from "../packages/core/src/constants.mts";
import {
  createRoot,
  readSentinel,
  type RootSentinel
} from "../packages/core/src/root.mts";

export type FixtureMode = "simple" | "advanced";

export interface CreateFixtureRootOptions {
  prefix?: string;
  rootId?: string;
}

export interface ApiFixtureLocationOptions {
  mode?: FixtureMode;
  topOrigin: string;
  requestOrigin?: string;
  scenario?: string;
  method: string;
  fixtureName: string;
}

export interface WriteApiFixtureOptions extends ApiFixtureLocationOptions {
  meta: unknown;
  body?: string;
}

export interface ManifestLocationOptions {
  mode?: FixtureMode;
  topOrigin: string;
  scenario?: string;
}

function originToKey(origin: string): string {
  const url = new URL(origin);
  const protocol = url.protocol.replace(":", "");
  const port = url.port ? `__${url.port}` : "";
  return `${protocol}__${url.hostname}${port}`;
}

export class WraithwalkerFixtureRoot {
  constructor(
    readonly rootPath: string,
    readonly sentinel: RootSentinel
  ) {}

  static async create(
    options: CreateFixtureRootOptions = {}
  ): Promise<WraithwalkerFixtureRoot> {
    const rootPath = await fs.mkdtemp(
      path.join(os.tmpdir(), options.prefix ?? "wraithwalker-test-")
    );
    const created = await createRoot(rootPath);

    if (options.rootId) {
      const sentinel: RootSentinel = {
        ...created,
        rootId: options.rootId
      };
      await fs.writeFile(
        path.join(rootPath, ROOT_SENTINEL_RELATIVE_PATH),
        JSON.stringify(sentinel, null, 2),
        "utf8"
      );
    }

    return new WraithwalkerFixtureRoot(rootPath, await readSentinel(rootPath));
  }

  get rootId(): string {
    return this.sentinel.rootId;
  }

  resolve(relativePath: string): string {
    return path.join(this.rootPath, relativePath);
  }

  originKey(origin: string): string {
    return originToKey(origin);
  }

  scenarioRelativePath(name: string): string {
    return path.join(SCENARIOS_DIR, name);
  }

  cliConfigRelativePath(): string {
    return path.join(WRAITHWALKER_DIR, "cli.json");
  }

  projectConfigRelativePath(): string {
    return PROJECT_CONFIG_RELATIVE_PATH;
  }

  manifestRelativePath({
    topOrigin,
    scenario
  }: ManifestLocationOptions): string {
    const topOriginKey = originToKey(topOrigin);
    const base = scenario ? this.scenarioRelativePath(scenario) : "";

    return path.join(
      base,
      MANIFESTS_DIR,
      topOriginKey,
      STATIC_RESOURCE_MANIFEST_FILE
    );
  }

  apiFixturePaths({
    topOrigin,
    requestOrigin = topOrigin,
    scenario,
    method,
    fixtureName
  }: ApiFixtureLocationOptions): {
    fixtureDir: string;
    metaPath: string;
    bodyPath: string;
  } {
    const topOriginKey = originToKey(topOrigin);
    const requestOriginKey = originToKey(requestOrigin);
    const base = scenario ? this.scenarioRelativePath(scenario) : "";

    const fixtureDir = path.join(
      base,
      CAPTURE_HTTP_DIR,
      topOriginKey,
      "origins",
      requestOriginKey,
      "http",
      method,
      fixtureName
    );

    return {
      fixtureDir,
      metaPath: path.join(fixtureDir, "response.meta.json"),
      bodyPath: path.join(fixtureDir, "response.body")
    };
  }

  async writeText(relativePath: string, content: string): Promise<string> {
    const filePath = this.resolve(relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    return relativePath;
  }

  async writeJson(relativePath: string, data: unknown): Promise<string> {
    await this.writeText(relativePath, JSON.stringify(data, null, 2));
    return relativePath;
  }

  async readJson<T>(relativePath: string): Promise<T> {
    return JSON.parse(
      await fs.readFile(this.resolve(relativePath), "utf8")
    ) as T;
  }

  async writeCliConfig(config: unknown): Promise<string> {
    const relativePath = this.cliConfigRelativePath();
    await this.writeJson(relativePath, config);
    return relativePath;
  }

  async writeProjectConfig(config: unknown): Promise<string> {
    const relativePath = this.projectConfigRelativePath();
    await this.writeJson(relativePath, config);
    return relativePath;
  }

  async ensureScenario(name: string): Promise<string> {
    const relativePath = this.scenarioRelativePath(name);
    await fs.mkdir(this.resolve(relativePath), { recursive: true });
    return relativePath;
  }

  async ensureOrigin({
    topOrigin,
    scenario
  }: ManifestLocationOptions): Promise<string> {
    const topOriginKey = originToKey(topOrigin);
    const base = scenario ? this.scenarioRelativePath(scenario) : "";
    const manifestDir = path.join(base, MANIFESTS_DIR, topOriginKey);
    const captureDir = path.join(
      base,
      CAPTURE_HTTP_DIR,
      topOriginKey,
      "origins"
    );

    await fs.mkdir(this.resolve(manifestDir), { recursive: true });
    await fs.mkdir(this.resolve(captureDir), { recursive: true });
    return captureDir;
  }

  async writeManifest(
    options: ManifestLocationOptions & { manifest: unknown }
  ): Promise<string> {
    const relativePath = this.manifestRelativePath(options);
    await this.writeJson(relativePath, options.manifest);
    return relativePath;
  }

  async writeApiFixture(options: WriteApiFixtureOptions): Promise<{
    fixtureDir: string;
    metaPath: string;
    bodyPath: string;
  }> {
    const paths = this.apiFixturePaths(options);
    await this.writeJson(paths.metaPath, options.meta);

    if ("body" in options) {
      await this.writeText(paths.bodyPath, options.body ?? "");
    }

    return paths;
  }
}

export async function createWraithwalkerFixtureRoot(
  options?: CreateFixtureRootOptions
): Promise<WraithwalkerFixtureRoot> {
  return WraithwalkerFixtureRoot.create(options);
}
