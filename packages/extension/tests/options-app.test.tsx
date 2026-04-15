// @vitest-environment jsdom

import * as React from "react";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import {
  getSwitchDialogTargetName,
  withSwitchDialogTargetName
} from "../src/ui/options-app.helpers.js";
import {
  DEFAULT_NATIVE_HOST_CONFIG,
  type EditorPreset
} from "../src/lib/constants.js";
import type { OptionsAppProps } from "../src/ui/options-app.js";
import { OptionsApp } from "../src/ui/options-app.js";
import type { NativeHostConfig, SessionSnapshot } from "../src/lib/types.js";
import { createTestChromeApi } from "./helpers/chrome-api-test-helpers.js";

afterEach(() => {
  cleanup();
  vi.doUnmock("react");
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

function createRuntimeSendMessage({
  sessionSnapshot = createSessionSnapshot()
}: {
  sessionSnapshot?: SessionSnapshot;
} = {}) {
  return vi.fn(async (message: { type: string }) => {
    switch (message.type) {
      case "session.getState":
        return sessionSnapshot;
      case "scenario.list":
        return {
          ok: true,
          scenarios: [],
          snapshots: [],
          activeScenarioName: null,
          activeScenarioMissing: false,
          activeTrace: null,
          supportsTraceSave: false
        };
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
  sessionSnapshot
}: {
  nativeHostConfig?: NativeHostConfig;
  editorPresets?: EditorPreset[];
  sessionSnapshot?: SessionSnapshot;
} = {}) {
  const runtimeSendMessage = createRuntimeSendMessage({ sessionSnapshot });
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
    getNativeHostConfig,
    getSiteConfigs: vi.fn().mockResolvedValue([]),
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

async function openAdvancedLaunchSettings() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Show" }));
  await screen.findByLabelText("Custom URL Override For Cursor");
  return user;
}

function extractLastNativeHostConfigUpdater(
  updates: Array<React.SetStateAction<NativeHostConfig | null>>
) {
  const update = [...updates]
    .reverse()
    .find(
      (
        value
      ): value is (current: NativeHostConfig | null) => NativeHostConfig | null =>
        typeof value === "function"
    );

  if (!update) {
    throw new Error("Expected a native host config updater function.");
  }

  return update;
}

async function loadOptionsAppWithNativeHostConfigCapture(
  updates: Array<React.SetStateAction<NativeHostConfig | null>>
) {
  vi.resetModules();
  vi.doMock("react", async () => {
    const actual = await vi.importActual<typeof import("react")>("react");
    let callCount = 0;

    return {
      ...actual,
      useState(initial: unknown) {
        callCount += 1;
        const tuple = actual.useState(initial as never) as [
          unknown,
          React.Dispatch<unknown>
        ];

        if (callCount % 20 === 5) {
          const [value, setValue] = tuple;
          const wrappedSet = (next: unknown) => {
            updates.push(next as React.SetStateAction<NativeHostConfig | null>);
            return setValue(next);
          };

          return [value, wrappedSet];
        }

        return tuple;
      }
    };
  });

  const module = await import("../src/ui/options-app.js");

  return module.OptionsApp;
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

    render(<OptionsApp {...props} />);

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

    render(<OptionsApp {...props} />);

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

  it("keeps the URL override updater null-safe when native host config state is missing", async () => {
    const nativeHostConfigUpdates: Array<
      React.SetStateAction<NativeHostConfig | null>
    > = [];
    const CapturedOptionsApp = await loadOptionsAppWithNativeHostConfigCapture(
      nativeHostConfigUpdates
    );

    const { props } = createOptionsAppHarness();
    render(<CapturedOptionsApp {...props} />);

    await openAdvancedLaunchSettings();
    fireEvent.change(screen.getByLabelText("Custom URL Override For Cursor"), {
      target: { value: "cursor://workspace?folder=$DIR_COMPONENT" }
    });

    const update = extractLastNativeHostConfigUpdater(nativeHostConfigUpdates);

    expect(update(null)).toBeNull();
  });

  it("keeps the command override updater null-safe when native host config state is missing", async () => {
    const nativeHostConfigUpdates: Array<
      React.SetStateAction<NativeHostConfig | null>
    > = [];
    const CapturedOptionsApp = await loadOptionsAppWithNativeHostConfigCapture(
      nativeHostConfigUpdates
    );

    const { props } = createOptionsAppHarness();
    render(<CapturedOptionsApp {...props} />);

    await openAdvancedLaunchSettings();
    fireEvent.change(
      screen.getByLabelText("Custom Command Override For Cursor"),
      {
        target: { value: 'cursor --folder "$DIR"' }
      }
    );

    const update = extractLastNativeHostConfigUpdater(nativeHostConfigUpdates);

    expect(update(null)).toBeNull();
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
});
