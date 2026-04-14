import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthorityHarness } from "./helpers/background-authority-test-helpers.js";
import { createChromeApi } from "./helpers/background-service-test-helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("background authority diagnostics", () => {
  it("reports missing roots, missing configs, and server disconnects in diagnostics", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return { ok: false, error: "No root directory selected." };
      }
      if (message?.type === "fs.readConfiguredSiteConfigs" || message?.type === "fs.readEffectiveSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });

    const { authority } = createAuthorityHarness({
      chromeApi,
      stateOverrides: {
        lastError: "transport unavailable",
        nativeHostConfig: { hostName: "", launchPath: "", editorLaunchOverrides: {} }
      },
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      }
    });

    const report = await authority.getDiagnosticsReport();

    expect(report.issues).toEqual(expect.arrayContaining([
      "No active capture root is ready.",
      "No enabled origins are configured.",
      "Native host name is not configured.",
      "Local WraithWalker server is not connected.",
      "Last runtime error: transport unavailable"
    ]));
  });

  it("returns diagnostics for configured/effective config failures and local-root permission errors", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return { ok: false, error: "Permission denied." };
      }
      if (message?.type === "fs.readConfiguredSiteConfigs") {
        return { ok: false, error: "configured read failed" };
      }
      if (message?.type === "fs.readEffectiveSiteConfigs") {
        return { ok: false, error: "effective read failed" };
      }
      return { ok: true };
    });

    const { authority } = createAuthorityHarness({
      chromeApi,
      stateOverrides: {
        lastError: "transport unavailable"
      },
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      }
    });

    const report = await authority.getDiagnosticsReport();

    expect(report.issues).toEqual(expect.arrayContaining([
      "Configured-site read failed: configured read failed",
      "Effective-site read failed: effective read failed",
      "Local root check failed: Permission denied."
    ]));
    expect(report.config.configuredSiteError).toBe("configured read failed");
    expect(report.config.effectiveSiteError).toBe("effective read failed");
  });
});
