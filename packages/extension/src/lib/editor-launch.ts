import {
  DEFAULT_EDITOR_ID,
  DEFAULT_NATIVE_HOST_CONFIG,
  EDITOR_PRESETS,
  type EditorPreset
} from "./constants.js";
import type { EditorLaunchOverride, NativeHostConfig } from "./types.js";

type LegacyNativeHostConfig = Partial<NativeHostConfig> & {
  rootPath?: string;
  commandTemplate?: string;
  urlTemplate?: string;
  editorLaunchOverrides?: Record<string, Partial<EditorLaunchOverride>>;
};

function trimOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeEditorLaunchOverride(
  value: Partial<EditorLaunchOverride> | undefined
): EditorLaunchOverride | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const commandTemplate = trimOptionalString(value.commandTemplate);
  const urlTemplate = trimOptionalString(value.urlTemplate);
  if (!commandTemplate && !urlTemplate) {
    return undefined;
  }

  return {
    ...(commandTemplate ? { commandTemplate } : {}),
    ...(urlTemplate ? { urlTemplate } : {})
  };
}

export function findEditorPreset(editorId?: string): EditorPreset | undefined {
  return EDITOR_PRESETS.find((preset) => preset.id === editorId);
}

export function normalizePreferredEditorId(editorId: unknown): string {
  if (typeof editorId === "string" && findEditorPreset(editorId)) {
    return editorId;
  }

  return DEFAULT_EDITOR_ID;
}

export function normalizeEditorLaunchOverrides(
  overrides: unknown
): Record<string, EditorLaunchOverride> {
  if (!overrides || typeof overrides !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(overrides)
      .map(
        ([editorId, value]) =>
          [
            editorId,
            normalizeEditorLaunchOverride(
              value as Partial<EditorLaunchOverride> | undefined
            )
          ] as const
      )
      .filter((entry): entry is [string, EditorLaunchOverride] =>
        Boolean(entry[1])
      )
  );
}

export function normalizeNativeHostConfig(
  rawConfig: unknown,
  preferredEditorId: string = DEFAULT_EDITOR_ID
): NativeHostConfig {
  const stored =
    rawConfig && typeof rawConfig === "object"
      ? (rawConfig as LegacyNativeHostConfig)
      : {};
  const normalizedPreferredEditorId =
    normalizePreferredEditorId(preferredEditorId);
  const editorLaunchOverrides = normalizeEditorLaunchOverrides(
    stored.editorLaunchOverrides
  );
  const legacyCommandTemplate = trimOptionalString(stored.commandTemplate);
  const legacyUrlTemplate = trimOptionalString(stored.urlTemplate);

  if (legacyCommandTemplate || legacyUrlTemplate) {
    editorLaunchOverrides[normalizedPreferredEditorId] = {
      ...editorLaunchOverrides[normalizedPreferredEditorId],
      ...(editorLaunchOverrides[normalizedPreferredEditorId]?.commandTemplate
        ? {}
        : legacyCommandTemplate
          ? { commandTemplate: legacyCommandTemplate }
          : {}),
      ...(editorLaunchOverrides[normalizedPreferredEditorId]?.urlTemplate
        ? {}
        : legacyUrlTemplate
          ? { urlTemplate: legacyUrlTemplate }
          : {})
    };
  }

  return {
    ...DEFAULT_NATIVE_HOST_CONFIG,
    hostName:
      typeof stored.hostName === "string"
        ? stored.hostName
        : DEFAULT_NATIVE_HOST_CONFIG.hostName,
    launchPath:
      typeof stored.launchPath === "string"
        ? stored.launchPath
        : typeof stored.rootPath === "string"
          ? stored.rootPath
          : DEFAULT_NATIVE_HOST_CONFIG.launchPath,
    editorLaunchOverrides
  };
}

export function updateEditorLaunchOverride(
  nativeHostConfig: NativeHostConfig,
  editorId: string,
  override: Partial<EditorLaunchOverride>
): NativeHostConfig {
  const normalizedEditorId = normalizePreferredEditorId(editorId);
  const nextOverrides = { ...nativeHostConfig.editorLaunchOverrides };
  const normalizedOverride = normalizeEditorLaunchOverride(override);

  if (normalizedOverride) {
    nextOverrides[normalizedEditorId] = normalizedOverride;
  } else {
    delete nextOverrides[normalizedEditorId];
  }

  return {
    ...nativeHostConfig,
    editorLaunchOverrides: nextOverrides
  };
}

export function getEditorLaunchOverride(
  nativeHostConfig: NativeHostConfig,
  editorId: string
): EditorLaunchOverride {
  return (
    nativeHostConfig.editorLaunchOverrides?.[
      normalizePreferredEditorId(editorId)
    ] ?? {}
  );
}

export interface ResolvedEditorLaunch {
  editorId: string;
  preset: EditorPreset;
  override: EditorLaunchOverride;
  urlTemplate: string;
  appUrl: string;
  commandTemplate: string;
  hasBuiltInUrlTemplate: boolean;
  hasBuiltInAppUrl: boolean;
  hasCustomUrlOverride: boolean;
  hasCustomCommandOverride: boolean;
}

export function resolveEditorLaunch(
  nativeHostConfig: NativeHostConfig,
  editorId: string = DEFAULT_EDITOR_ID
): ResolvedEditorLaunch {
  const preset =
    findEditorPreset(editorId) ?? findEditorPreset(DEFAULT_EDITOR_ID)!;
  const override = getEditorLaunchOverride(nativeHostConfig, preset.id);
  const builtInUrlTemplate = trimOptionalString(preset.urlTemplate) ?? "";
  const builtInAppUrl = trimOptionalString(preset.appUrl) ?? "";
  const builtInCommandTemplate =
    trimOptionalString(preset.commandTemplate) ?? "";

  return {
    editorId: preset.id,
    preset,
    override,
    urlTemplate: trimOptionalString(override.urlTemplate) ?? builtInUrlTemplate,
    appUrl: builtInAppUrl,
    commandTemplate:
      trimOptionalString(override.commandTemplate) ?? builtInCommandTemplate,
    hasBuiltInUrlTemplate: Boolean(builtInUrlTemplate),
    hasBuiltInAppUrl: Boolean(builtInAppUrl),
    hasCustomUrlOverride: Boolean(trimOptionalString(override.urlTemplate)),
    hasCustomCommandOverride: Boolean(
      trimOptionalString(override.commandTemplate)
    )
  };
}

function normalizePathForUrl(rootPath: string): string {
  return rootPath.replaceAll("\\", "/");
}

export function buildEditorLaunchUrl(
  urlTemplate: string,
  rootPath: string,
  rootId: string
): string {
  const normalizedPath = normalizePathForUrl(rootPath);
  const url = urlTemplate
    .replaceAll("$DIR_COMPONENT", encodeURIComponent(normalizedPath))
    .replaceAll("$DIR_URI", encodeURI(normalizedPath))
    .replaceAll("$ROOT_ID", encodeURIComponent(rootId))
    .replaceAll("$DIR", normalizedPath);

  return new URL(url).toString();
}

export function buildEditorAppUrl(appUrl: string): string {
  return new URL(appUrl).toString();
}

export function buildCursorPromptText(origins: string[]): string {
  const originSummary = origins.length
    ? origins.join(", ")
    : "none selected yet";

  return [
    "This folder is a WraithWalker fixture root with dumped website assets, manifests, API fixtures, and replay metadata.",
    `Selected origins: ${originSummary}.`,
    "Read the workspace context files first, then Prettify minified or dumped contents before reasoning about them.",
    "Start by understanding the structure of the website across the selected origins before making changes.",
    "Use RESOURCE_MANIFEST.json files, sidecar metadata, and API fixtures to map how requests, chunks, and pages fit together."
  ].join("\n");
}

export function buildCursorPromptUrl(promptText: string): string {
  return `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(promptText)}`;
}
