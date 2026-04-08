import type { ErrorResult, FixtureHasResult, FixtureReadResult, FixtureWriteResult, OffscreenMessage, RootReadyResult } from "./lib/messages.js";
import { createFileSystemGateway } from "./lib/file-system-gateway.js";
import { createExtensionRootRuntime } from "./lib/root-runtime.js";
import { ensureRootSentinel as defaultEnsureRootSentinel, loadStoredRootHandle as defaultLoadStoredRootHandle, queryRootPermission as defaultQueryRootPermission, requestRootPermission as defaultRequestRootPermission } from "./lib/root-handle.js";
import type { FixtureDescriptor, RequestPayload, ResponseMeta, RootSentinel } from "./lib/types.js";

interface RuntimeApi {
  onMessage: {
    addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void): void;
  };
}

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
  runtime?: RuntimeApi;
  loadStoredRootHandle?: typeof defaultLoadStoredRootHandle;
  ensureRootSentinel?: typeof defaultEnsureRootSentinel;
  queryRootPermission?: typeof defaultQueryRootPermission;
  requestRootPermission?: typeof defaultRequestRootPermission;
  base64ToBytes?: (value: string) => Uint8Array;
  arrayBufferToBase64?: (buffer: ArrayBuffer) => string;
}

function isOffscreenTargetMessage(message: unknown): message is { target: "offscreen"; type?: string; payload?: unknown } {
  if (!message || typeof message !== "object") {
    return false;
  }

  const typedMessage = message as { target?: string; type?: string };
  return typedMessage.target === "offscreen";
}

function isKnownOffscreenMessage(message: unknown): message is OffscreenMessage {
  if (!isOffscreenTargetMessage(message)) {
    return false;
  }

  return [
    "fs.ensureRoot",
    "fs.hasFixture",
    "fs.readFixture",
    "fs.writeFixture",
    "fs.generateContext"
  ].includes(message.type || "");
}

function toErrorResult(result: { error?: string; permission?: PermissionState }): ErrorResult {
  return {
    ok: false,
    error: result.error || "Unknown error.",
    permission: result.permission
  };
}

function isTestMode(): boolean {
  return Boolean((globalThis as typeof globalThis & { __WRAITHWALKER_TEST__?: boolean }).__WRAITHWALKER_TEST__);
}

export function createOffscreenRuntime({
  runtime = chrome.runtime as unknown as RuntimeApi,
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

  async function getRootState({ requestPermission = false }: { requestPermission?: boolean } = {}): Promise<RootStateResult> {
    const rootHandle = await loadStoredRootHandle();
    if (!rootHandle) {
      return { ok: false, error: "No root directory selected." };
    }

    let permission = await queryRootPermission(rootHandle);
    if (permission !== "granted" && requestPermission) {
      permission = await requestRootPermission(rootHandle);
    }

    if (permission !== "granted") {
      return { ok: false, error: "Root directory access is not granted.", permission };
    }

    const runtime = createExtensionRootRuntime({
      rootHandle,
      gateway: fileSystemGateway,
      ensureSentinel: ensureRootSentinel
    });
    const sentinel = await runtime.ensureReady();
    return { ok: true, rootHandle, sentinel, permission, runtime };
  }

  async function handleHasFixture(payload: { descriptor: FixtureDescriptor }): Promise<FixtureHasResult> {
    const rootState = await getRootState();
    if (!rootState.ok) {
      return toErrorResult(rootState as ErrorResult);
    }

    return { ok: true, exists: await rootState.runtime.has(payload.descriptor) };
  }

  async function handleReadFixture(payload: { descriptor: FixtureDescriptor }): Promise<FixtureReadResult> {
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

  async function handleMessage(message: unknown): Promise<RootReadyResult | FixtureHasResult | FixtureReadResult | FixtureWriteResult | { ok: true } | undefined> {
    if (!isOffscreenTargetMessage(message)) {
      return undefined;
    }

    if (!isKnownOffscreenMessage(message)) {
      return { ok: false, error: `Unknown offscreen message: ${String(message.type)}` };
    }

    switch (message.type) {
      case "fs.ensureRoot": {
        const result = await getRootState(message.payload);
        return result.ok
          ? { ok: true, sentinel: result.sentinel, permission: result.permission }
          : result;
      }
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

  function register(): void {
    runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isOffscreenTargetMessage(message)) {
        return undefined;
      }

      handleMessage(message)
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
