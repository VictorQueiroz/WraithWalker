import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createChromeApi,
  createMessageRuntimeApi,
  createOffscreenRuntimeApi,
  createOptionsChromeApi,
  createPopupRuntimeApi
} from "../src/lib/chrome-api.js";
import {
  createTestChromeApi,
  installTestChromeApi
} from "./helpers/chrome-api-test-helpers.js";

afterEach(() => {
  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  vi.restoreAllMocks();
});

describe("chrome api adapters", () => {
  it("creates adapters from the global chrome object by default", () => {
    const rawChrome = installTestChromeApi();

    expect(createChromeApi()).toEqual(
      expect.objectContaining({
        runtime: rawChrome.runtime,
        debugger: rawChrome.debugger,
        tabs: rawChrome.tabs,
        storage: rawChrome.storage,
        offscreen: rawChrome.offscreen,
        alarms: rawChrome.alarms,
        permissions: rawChrome.permissions,
        contextMenus: rawChrome.contextMenus
      })
    );
    expect(createMessageRuntimeApi().sendMessage).toBe(rawChrome.runtime.sendMessage);
    expect(createPopupRuntimeApi().openOptionsPage).toBe(
      rawChrome.runtime.openOptionsPage
    );
    expect(createOffscreenRuntimeApi().onMessage).toBe(rawChrome.runtime.onMessage);
    expect(createOptionsChromeApi().permissions.request).toBe(
      rawChrome.permissions!.request
    );
  });

  it("creates adapters from a supplied raw chrome object and preserves missing optional namespaces", () => {
    const rawChrome = createTestChromeApi({
      alarms: undefined,
      permissions: undefined,
      contextMenus: undefined
    });

    const chromeApi = createChromeApi(rawChrome);

    expect(chromeApi.runtime).toBe(rawChrome.runtime);
    expect(chromeApi.alarms).toBeUndefined();
    expect(chromeApi.permissions).toBeUndefined();
    expect(chromeApi.contextMenus).toBeUndefined();
  });

  it("builds test chrome adapters with override hooks and supports global installation", () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    const requestPermission = vi.fn().mockResolvedValue(false);
    const injectedChrome = createTestChromeApi({
      runtime: { sendMessage },
      permissions: { request: requestPermission }
    });

    expect(injectedChrome.runtime.sendMessage).toBe(sendMessage);
    expect(injectedChrome.permissions?.request).toBe(requestPermission);
    expect(injectedChrome.storage.local.get).toBeTypeOf("function");
    expect(injectedChrome.runtime.openOptionsPage).toBeTypeOf("function");

    const installedChrome = installTestChromeApi({
      contextMenus: undefined
    });

    expect(globalThis.chrome).toBe(installedChrome);
    expect(createChromeApi().contextMenus).toBeUndefined();
  });
});
