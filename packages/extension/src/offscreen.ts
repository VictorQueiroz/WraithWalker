import type {
  ErrorResult,
  FixtureHasResult,
  FixtureReadResult,
  FixtureWriteResult,
  OffscreenMessage,
  RootReadyResult,
  SiteConfigsResult
} from "./lib/messages.js";
import { createFileSystemGateway } from "./lib/file-system-gateway.js";
import { createExtensionRootRuntime } from "./lib/root-runtime.js";
import {
  ensureRootSentinel as defaultEnsureRootSentinel,
  loadStoredRootHandle as defaultLoadStoredRootHandle,
  queryRootPermission as defaultQueryRootPermission,
  requestRootPermission as defaultRequestRootPermission
} from "./lib/root-handle.js";
import {
  classifyOffscreenMessage,
  type OffscreenMessageClassification
} from "./lib/offscreen-message.js";
import {
  createOffscreenRuntimeApi,
  type OffscreenRuntimeApi
} from "./lib/chrome-api.js";
import type {
  FixtureDescriptor,
  RequestPayload,
  ResponseMeta,
  RootSentinel,
  SiteConfig
} from "./lib/types.js";

interface FixtureResponsePayload {
  body: string;
  bodyEncoding: "utf8" | "base64";
  meta: ResponseMeta;
}

interface RootStateSuccess {
  ok: true;
  rootHandle: FileSystemDirectoryHandle;
  sentinel: RootSentinel;
  permission: PermissionState;
  runtime: ReturnType<typeof createExtensionRootRuntime>;
}

type RootStateResult = RootStateSuccess | ErrorResult;

interface OffscreenDependencies {
  runtime?: OffscreenRuntimeApi;
  loadStoredRootHandle?: typeof defaultLoadStoredRootHandle;
  ensureRootSentinel?: typeof defaultEnsureRootSentinel;
  queryRootPermission?: typeof defaultQueryRootPermission;
  requestRootPermission?: typeof defaultRequestRootPermission;
  base64ToBytes?: (value: string) => Uint8Array;
  arrayBufferToBase64?: (buffer: ArrayBuffer) => string;
}

function toErrorResult(result: {
  error?: string;
  permission?: PermissionState;
}): ErrorResult {
  return {
    ok: false,
    error: result.error || "Unknown error.",
    permission: result.permission
  };
}

function isTestMode(): boolean {
  return Boolean(
    (globalThis as typeof globalThis & { __WRAITHWALKER_TEST__?: boolean })
      .__WRAITHWALKER_TEST__
  );
}

export function createOffscreenRuntime({
  runtime = createOffscreenRuntimeApi(),
  loadStoredRootHandle = defaultLoadStoredRootHandle,
  ensureRootSentinel = defaultEnsureRootSentinel,
  queryRootPermission = defaultQueryRootPermission,
  requestRootPermission = defaultRequestRootPermission,
  base64ToBytes,
  arrayBufferToBase64
}: OffscreenDependencies = {}) {
  const fileSystemGateway = createFileSystemGateway({
    base64ToBytes,
    arrayBufferToBase64
  });

  async function getRootState({
    requestPermission = false
  }: { requestPermission?: boolean } = {}): Promise<RootStateResult> {
    const rootHandle = await loadStoredRootHandle();
    if (!rootHandle) {
      return { ok: false, error: "No root directory selected." };
    }

    let permission = await queryRootPermission(rootHandle);
    if (permission !== "granted" && requestPermission) {
      permission = await requestRootPermission(rootHandle);
    }

    if (permission !== "granted") {
      return {
        ok: false,
        error: "Root directory access is not granted.",
        permission
      };
    }

    const runtime = createExtensionRootRuntime({
      rootHandle,
      gateway: fileSystemGateway,
      ensureSentinel: ensureRootSentinel
    });
    const sentinel = await runtime.ensureReady();
    return { ok: true, rootHandle, sentinel, permission, runtime };
  }

  async function handleHasFixture(payload: {
    descriptor: FixtureDescriptor;
  }): Promise<FixtureHasResult> {
    const rootState = await getRootState();
    if (!rootState.ok) {
      return toErrorResult(rootState as ErrorResult);
    }

    return {
      ok: true,
      exists: await rootState.runtime.has(payload.descriptor)
    };
  }

  async function handleReadFixture(payload: {
    descriptor: FixtureDescriptor;
  }): Promise<FixtureReadResult> {
    const rootState = await getRootState();
    if (!rootState.ok) {
      return toErrorResult(rootState as ErrorResult);
    }

    const fixture = await rootState.runtime.read(payload.descriptor);

    if (!fixture) {
      return { ok: true, exists: false };
    }

    return {
      ok: true,
      exists: true,
      request: fixture.request,
      meta: fixture.meta,
      bodyBase64: fixture.bodyBase64,
      size: fixture.size,
      sentinel: rootState.sentinel
    };
  }

  async function handleWriteFixture(payload: {
    descriptor: FixtureDescriptor;
    request: RequestPayload;
    response: FixtureResponsePayload;
  }): Promise<FixtureWriteResult> {
    const rootState = await getRootState();
    if (!rootState.ok) {
      return toErrorResult(rootState as ErrorResult);
    }

    await rootState.runtime.writeIfAbsent(payload);

    return {
      ok: true,
      descriptor: payload.descriptor,
      sentinel: rootState.sentinel
    };
  }

  async function handleReadConfiguredSiteConfigs(): Promise<SiteConfigsResult> {
    const rootState = await getRootState();
    if (!rootState.ok) {
      return toErrorResult(rootState as ErrorResult);
    }

    return {
      ok: true,
      siteConfigs: await rootState.runtime.readConfiguredSiteConfigs(),
      sentinel: rootState.sentinel
    };
  }

  async function handleReadEffectiveSiteConfigs(): Promise<SiteConfigsResult> {
    const rootState = await getRootState();
    if (!rootState.ok) {
      return toErrorResult(rootState as ErrorResult);
    }

    return {
      ok: true,
      siteConfigs: await rootState.runtime.readEffectiveSiteConfigs(),
      sentinel: rootState.sentinel
    };
  }

  async function handleWriteConfiguredSiteConfigs(payload: {
    siteConfigs: SiteConfig[];
  }): Promise<SiteConfigsResult> {
    const rootState = await getRootState();
    if (!rootState.ok) {
      return toErrorResult(rootState as ErrorResult);
    }

    await rootState.runtime.writeConfiguredSiteConfigs(payload.siteConfigs);

    return {
      ok: true,
      siteConfigs: await rootState.runtime.readConfiguredSiteConfigs(),
      sentinel: rootState.sentinel
    };
  }

  async function handleKnownMessage(
    message: OffscreenMessage
  ): Promise<
    | RootReadyResult
    | SiteConfigsResult
    | FixtureHasResult
    | FixtureReadResult
    | FixtureWriteResult
    | { ok: true }
  > {
    switch (message.type) {
      case "fs.ensureRoot": {
        const result = await getRootState(message.payload);
        return result.ok
          ? {
              ok: true,
              sentinel: result.sentinel,
              permission: result.permission
            }
          : result;
      }
      case "fs.readConfiguredSiteConfigs":
        return handleReadConfiguredSiteConfigs();
      case "fs.readEffectiveSiteConfigs":
        return handleReadEffectiveSiteConfigs();
      case "fs.writeConfiguredSiteConfigs":
        return handleWriteConfiguredSiteConfigs(message.payload);
      case "fs.hasFixture":
        return handleHasFixture(message.payload);
      case "fs.readFixture":
        return handleReadFixture(message.payload);
      case "fs.writeFixture":
        return handleWriteFixture(message.payload);
      case "fs.generateContext": {
        const rootState = await getRootState();
        if (!rootState.ok) return rootState;
        await rootState.runtime.generateContext({
          editorId: message.payload.editorId,
          siteConfigs: message.payload.siteConfigs
        });
        return { ok: true };
      }
    }
  }

  function unknownMessageError(classified: Extract<
    OffscreenMessageClassification,
    { kind: "unknown" }
  >): ErrorResult {
    return {
      ok: false,
      error: `Unknown offscreen message: ${String(classified.type)}`
    };
  }

  async function handleMessage(
    message: unknown
  ): Promise<
    | RootReadyResult
    | SiteConfigsResult
    | FixtureHasResult
    | FixtureReadResult
    | FixtureWriteResult
    | { ok: true }
    | undefined
  > {
    const classified = classifyOffscreenMessage(message);
    if (classified.kind === "ignore") {
      return undefined;
    }

    return classified.kind === "unknown"
      ? unknownMessageError(classified)
      : handleKnownMessage(classified.message);
  }

  function register(): void {
    runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const classified = classifyOffscreenMessage(message);
      if (classified.kind === "ignore") {
        return undefined;
      }

      const responsePromise =
        classified.kind === "unknown"
          ? Promise.resolve(unknownMessageError(classified))
          : handleKnownMessage(classified.message);

      responsePromise
        .then((response) => sendResponse(response))
        .catch((error: unknown) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        });

      return true;
    });
  }

  return {
    getRootState,
    handleHasFixture,
    handleReadFixture,
    handleWriteFixture,
    handleMessage,
    register
  };
}

export function bootstrapOffscreen(): void {
  createOffscreenRuntime().register();
}

if (!isTestMode()) {
  bootstrapOffscreen();
}
