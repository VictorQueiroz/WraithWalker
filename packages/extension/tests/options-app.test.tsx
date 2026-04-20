// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import {
  getSwitchDialogTargetName,
  withSwitchDialogTargetName,
  withUpdatedEditorCommandOverride,
  withUpdatedEditorUrlOverride
} from "../src/ui/options-app.helpers.js";
import {
  DEFAULT_NATIVE_HOST_CONFIG,
  type EditorPreset
} from "../src/lib/constants.js";
import type { ScenarioListSuccess } from "../src/lib/messages.js";
import type { OptionsAppProps } from "../src/ui/options-app.js";
import { OptionsApp } from "../src/ui/options-app.js";
import type { NativeHostConfig, SessionSnapshot } from "../src/lib/types.js";
import { createOptionsQueryClient } from "../src/ui/options-app.queries.js";
import { createTestChromeApi } from "./helpers/chrome-api-test-helpers.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.doUnmock("react");
  vi.doUnmock("../src/ui/options-app.actions.js");
  vi.resetModules();
  vi.restoreAllMocks();
});

function createNativeHostConfig(
  overrides: Partial<NativeHostConfig> = {}
): NativeHostConfig {
  return {
    ...DEFAULT_NATIVE_HOST_CONFIG,
    ...overrides,
    editorLaunchOverrides: {
      ...DEFAULT_NATIVE_HOST_CONFIG.editorLaunchOverrides,
      ...overrides.editorLaunchOverrides
    }
  };
}

function createSessionSnapshot(
  overrides: Partial<SessionSnapshot> = {}
): SessionSnapshot {
  return {
    sessionActive: false,
    attachedTabIds: [],
    enabledOrigins: [],
    rootReady: false,
    captureDestination: "none",
    captureRootPath: "",
    lastError: "",
    ...overrides
  };
}

function createScenarioListResult(
  overrides: Partial<Omit<ScenarioListSuccess, "ok">> = {}
): ScenarioListSuccess {
  return {
    ok: true,
    scenarios: [],
    snapshots: [],
    activeScenarioName: null,
    activeScenarioMissing: false,
    activeTrace: null,
    supportsTraceSave: false,
    ...overrides
  };
}

function createRuntimeSendMessage({
  sessionSnapshot = createSessionSnapshot(),
  scenarioListResult = createScenarioListResult()
}: {
  sessionSnapshot?: SessionSnapshot;
  scenarioListResult?: ScenarioListSuccess;
} = {}) {
  return vi.fn(async (message: { type: string }) => {
    switch (message.type) {
      case "session.getState":
        return sessionSnapshot;
      case "scenario.list":
        return scenarioListResult;
      case "native.verify":
        return { ok: true, verifiedAt: "2026-04-03T12:00:00.000Z" };
      default:
        return { ok: true };
    }
  });
}

function createOptionsAppHarness({
  nativeHostConfig = createNativeHostConfig(),
  editorPresets,
  sessionSnapshot,
  scenarioListResult,
  siteConfigs = [],
  runtimeSendMessage: runtimeSendMessageOverride,
  setIntervalFn,
  clearIntervalFn
}: {
  nativeHostConfig?: NativeHostConfig;
  editorPresets?: EditorPreset[];
  sessionSnapshot?: SessionSnapshot;
  scenarioListResult?: ScenarioListSuccess;
  siteConfigs?: Array<{
    origin: string;
    createdAt: string;
    dumpAllowlistPatterns: string[];
  }>;
  runtimeSendMessage?: ReturnType<typeof vi.fn>;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
} = {}) {
  const runtimeSendMessage =
    runtimeSendMessageOverride ??
    createRuntimeSendMessage({ sessionSnapshot, scenarioListResult });
  const chromeApi = createTestChromeApi({
    runtime: {
      sendMessage: runtimeSendMessage
    }
  });
  let currentNativeHostConfig = nativeHostConfig;
  const getNativeHostConfig = vi.fn(async () => currentNativeHostConfig);
  const setNativeHostConfig = vi.fn(async (nextConfig: NativeHostConfig) => {
    currentNativeHostConfig = nextConfig;
  });
  const props: OptionsAppProps = {
    chromeApi: {
      runtime: chromeApi.runtime,
      permissions: chromeApi.permissions!
    },
    ...(setIntervalFn ? { setIntervalFn } : {}),
    ...(clearIntervalFn ? { clearIntervalFn } : {}),
    getNativeHostConfig,
    getSiteConfigs: vi.fn().mockResolvedValue(siteConfigs),
    setNativeHostConfig,
    setSiteConfigs: vi.fn().mockResolvedValue(undefined),
    loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
    queryRootPermission: vi.fn().mockResolvedValue("prompt"),
    requestRootPermission: vi.fn().mockResolvedValue("prompt"),
    ensureRootSentinel: vi.fn().mockResolvedValue(null),
    storeRootHandleWithSentinel: vi.fn().mockResolvedValue({
      rootId: "root-id"
    }),
    ...(editorPresets ? { editorPresets } : {})
  };

  return {
    runtimeSendMessage,
    getNativeHostConfig,
    setNativeHostConfig,
    props
  };
}

function renderOptionsApp(props: OptionsAppProps) {
  const queryClient = createOptionsQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <OptionsApp {...props} />
    </QueryClientProvider>
  );
}

async function renderOptionsAppWithActionOverrides({
  props,
  actionOverrides
}: {
  props: OptionsAppProps;
  actionOverrides: Partial<
    Awaited<typeof import("../src/ui/options-app.actions.js")>
  >;
}) {
  vi.resetModules();
  vi.doMock("../src/ui/options-app.actions.js", async () => {
    const actual = await vi.importActual<
      typeof import("../src/ui/options-app.actions.js")
    >("../src/ui/options-app.actions.js");

    return {
      ...actual,
      ...actionOverrides
    };
  });

  const [{ OptionsApp: MockedOptionsApp }, { createOptionsQueryClient }] =
    await Promise.all([
      import("../src/ui/options-app.js"),
      import("../src/ui/options-app.queries.js")
    ]);
  const queryClient = createOptionsQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <MockedOptionsApp {...props} />
    </QueryClientProvider>
  );
}

async function openAdvancedLaunchSettings() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Show" }));
  await screen.findByLabelText("Custom URL Override For Cursor");
  return user;
}

describe("OptionsApp launch settings", () => {
  it("falls back to the custom URL placeholder when the Cursor preset has no built-in urlTemplate", async () => {
    const { props } = createOptionsAppHarness({
      editorPresets: [
        {
          id: "cursor",
          label: "Cursor",
          commandTemplate: 'cursor "$DIR"'
        },
        {
          id: "vscode",
          label: "VS Code",
          commandTemplate: 'code "$DIR"',
          urlTemplate: "vscode://file/$DIR_URI/"
        }
      ]
    });

    renderOptionsApp(props);

    await openAdvancedLaunchSettings();

    expect(
      screen
        .getByLabelText("Custom URL Override For Cursor")
        .getAttribute("placeholder")
    ).toBe("custom://open?folder=$DIR_COMPONENT");
  });

  it("creates a new cursor URL override without disturbing the saved host name or launch path", async () => {
    const { props, setNativeHostConfig } = createOptionsAppHarness({
      nativeHostConfig: createNativeHostConfig({
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures",
        editorLaunchOverrides: {}
      })
    });

    renderOptionsApp(props);

    const user = await openAdvancedLaunchSettings();
    fireEvent.change(screen.getByLabelText("Custom URL Override For Cursor"), {
      target: { value: "cursor://workspace?folder=$DIR_COMPONENT" }
    });
    await user.click(
      screen.getByRole("button", { name: "Save Launch Settings" })
    );

    expect(setNativeHostConfig).toHaveBeenCalledWith(
      createNativeHostConfig({
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures",
        editorLaunchOverrides: {
          cursor: {
            urlTemplate: "cursor://workspace?folder=$DIR_COMPONENT"
          }
        }
      })
    );
    expect(await screen.findByText("Launch settings saved.")).toBeTruthy();
  });

  it("does not poll authority data while a site-pattern edit is still dirty", async () => {
    vi.useFakeTimers();
    const { props } = createOptionsAppHarness({
      sessionSnapshot: createSessionSnapshot({
        captureDestination: "server",
        rootReady: true,
        captureRootPath: "/tmp/server-root",
        enabledOrigins: ["https://docs.example.com"]
      }),
      siteConfigs: [
        {
          origin: "https://docs.example.com",
          createdAt: "2026-04-14T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }
      ]
    });
    renderOptionsApp({
      ...props,
      refreshIntervalMs: 25
    });
    await vi.advanceTimersByTimeAsync(0);

    const patternsInput = screen.getByLabelText("Dump Allowlist Patterns");
    fireEvent.change(patternsInput, { target: { value: "\\.tsx$" } });

    const getSiteConfigs = props.getSiteConfigs as ReturnType<typeof vi.fn>;
    const beforeTickCalls = getSiteConfigs.mock.calls.length;

    await vi.advanceTimersByTimeAsync(25);

    expect(getSiteConfigs).toHaveBeenCalledTimes(beforeTickCalls);
    expect((patternsInput as HTMLTextAreaElement).value).toBe("\\.tsx$");
  });

  it("renders one site card for duplicate normalized origins and writes a canonical save payload", async () => {
    const { props } = createOptionsAppHarness({
      sessionSnapshot: createSessionSnapshot({
        captureDestination: "server",
        rootReady: true,
        enabledOrigins: ["https://docs.example.com"]
      }),
      siteConfigs: [
        {
          origin: "docs.example.com",
          createdAt: "2026-04-14T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        },
        {
          origin: "https://docs.example.com",
          createdAt: "2026-04-13T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.json$", "\\.js$"]
        }
      ]
    });

    renderOptionsApp(props);

    expect(await screen.findAllByText("https://docs.example.com")).toHaveLength(
      1
    );
    const patternsInput = await screen.findByLabelText(
      "Dump Allowlist Patterns"
    );
    fireEvent.change(patternsInput, { target: { value: "\\.tsx$\n\\.json$" } });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(props.setSiteConfigs).toHaveBeenCalledWith([
      {
        origin: "https://docs.example.com",
        createdAt: "2026-04-13T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.tsx$", "\\.json$"]
      }
    ]);
  });

  it("removes duplicate normalized origins through a single site card", async () => {
    const { props } = createOptionsAppHarness({
      sessionSnapshot: createSessionSnapshot({
        captureDestination: "server",
        rootReady: true,
        enabledOrigins: ["https://docs.example.com"]
      }),
      siteConfigs: [
        {
          origin: "docs.example.com",
          createdAt: "2026-04-14T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        },
        {
          origin: "https://docs.example.com",
          createdAt: "2026-04-13T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.json$", "\\.js$"]
        }
      ]
    });

    renderOptionsApp(props);

    expect(await screen.findAllByText("https://docs.example.com")).toHaveLength(
      1
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(props.setSiteConfigs).toHaveBeenCalledWith([]);
    expect(props.chromeApi.permissions.remove).toHaveBeenCalledWith({
      origins: ["https://docs.example.com/*"]
    });
  });

  it("surfaces trace-save validation errors returned by the action layer and clears the busy state", async () => {
    const saveScenarioFromTraceAction = vi.fn().mockResolvedValue({
      kind: "validation_error",
      errorText: "Trace validation failed."
    });
    const { props } = createOptionsAppHarness({
      sessionSnapshot: createSessionSnapshot({
        captureDestination: "server",
        rootReady: true,
        enabledOrigins: ["https://app.example.com"]
      }),
      scenarioListResult: createScenarioListResult({
        supportsTraceSave: true,
        activeTrace: {
          traceId: "trace-1",
          status: "recording",
          createdAt: "2026-04-18T00:00:00.000Z",
          selectedOrigins: ["https://app.example.com"],
          extensionClientId: "client-1",
          stepCount: 1,
          linkedFixtureCount: 0,
          name: "Trace Example"
        }
      })
    });

    await renderOptionsAppWithActionOverrides({
      props,
      actionOverrides: {
        saveScenarioFromTraceAction
      }
    });

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Save Trace Snapshot" })
    );

    expect(saveScenarioFromTraceAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Trace validation failed.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Save Trace Snapshot" })
    ).toBeTruthy();
  });

  it("surfaces switch preparation errors from the action layer and clears the busy state", async () => {
    const prepareSwitchScenarioAction = vi.fn().mockResolvedValue({
      kind: "error",
      flash: {
        variant: "destructive",
        text: "Diff lookup failed."
      }
    });
    const { props } = createOptionsAppHarness({
      sessionSnapshot: createSessionSnapshot({
        captureDestination: "server",
        rootReady: true,
        enabledOrigins: ["https://app.example.com"]
      }),
      scenarioListResult: createScenarioListResult({
        scenarios: ["baseline", "candidate"],
        snapshots: [
          {
            name: "baseline",
            source: "manual",
            hasMetadata: true,
            isActive: true
          },
          {
            name: "candidate",
            source: "manual",
            hasMetadata: true,
            isActive: false
          }
        ],
        activeScenarioName: "baseline"
      })
    });

    await renderOptionsAppWithActionOverrides({
      props,
      actionOverrides: {
        prepareSwitchScenarioAction
      }
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Switch" }));

    expect(prepareSwitchScenarioAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Diff lookup failed.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch" })).toBeTruthy();
  });
});

describe("options app helpers", () => {
  it("returns null when no switch dialog is available", () => {
    expect(getSwitchDialogTargetName(null)).toBeNull();
  });

  it("returns the target name when a switch dialog is available", () => {
    expect(
      getSwitchDialogTargetName({
        targetName: "candidate"
      })
    ).toBe("candidate");
  });

  it("skips the callback when no switch dialog target is available", () => {
    const callback = vi.fn();

    expect(withSwitchDialogTargetName(null, callback)).toBeUndefined();
    expect(callback).not.toHaveBeenCalled();
  });

  it("invokes the callback when a switch dialog target is available", () => {
    const callback = vi.fn((targetName: string) => `switch:${targetName}`);

    expect(
      withSwitchDialogTargetName(
        {
          targetName: "candidate"
        },
        callback
      )
    ).toBe("switch:candidate");
    expect(callback).toHaveBeenCalledWith("candidate");
  });

  it("keeps the editor URL override updater null-safe when native host config state is missing", () => {
    expect(
      withUpdatedEditorUrlOverride(
        null,
        "cursor",
        "cursor://workspace?folder=$DIR_COMPONENT"
      )
    ).toBeNull();
  });

  it("keeps the editor command override updater null-safe when native host config state is missing", () => {
    expect(
      withUpdatedEditorCommandOverride(null, "cursor", 'cursor --folder "$DIR"')
    ).toBeNull();
  });
});
