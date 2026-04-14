import type {
  FixtureDescriptor,
  RequestPayload,
  ResponseMeta,
  RootSentinel,
  SessionSnapshot,
  SiteConfig
} from "./types.js";

export interface ErrorResult {
  ok: false;
  error: string;
  permission?: PermissionState;
}

export interface RootReadySuccess {
  ok: true;
  sentinel: RootSentinel;
  permission: PermissionState;
}

export type RootReadyResult = RootReadySuccess | ErrorResult;

export interface NativeVerifySuccess {
  ok: true;
  verifiedAt: string;
}

export type NativeVerifyResult = NativeVerifySuccess | ErrorResult;

export interface NativeOpenSuccess {
  ok: true;
}

export type NativeOpenResult = NativeOpenSuccess | ErrorResult;

export interface DiagnosticsAttachedTab {
  tabId: number;
  topOrigin: string;
  traceArmedForTraceId: string | null;
  hasTraceScriptIdentifier: boolean;
}

export interface DiagnosticsPendingRequest {
  tabId: number;
  requestId: string;
  method: string;
  url: string;
  replayed: boolean;
}

export interface DiagnosticsReport {
  generatedAt: string;
  extensionVersion: string;
  extensionClientId: string;
  sessionSnapshot: SessionSnapshot;
  localRoot: {
    ready: boolean;
    permission: PermissionState | null;
    sentinel: RootSentinel | null;
    error?: string;
    legacySiteConfigsMigrated: boolean;
  };
  server: {
    connected: boolean;
    checkedAt: string | null;
    rootPath: string;
    sentinel: RootSentinel | null;
    baseUrl: string;
    trpcUrl: string;
    mcpUrl: string;
    activeTraceId: string | null;
  };
  config: {
    configuredSiteConfigs: SiteConfig[];
    effectiveSiteConfigs: SiteConfig[];
    configuredSiteError?: string;
    effectiveSiteError?: string;
  };
  nativeHost: {
    configured: boolean;
    hostName: string;
    launchPath: string;
    preferredEditorId: string;
  };
  runtime: {
    attachedTabs: DiagnosticsAttachedTab[];
    pendingRequests: DiagnosticsPendingRequest[];
    lastError: string;
  };
  issues: string[];
}

export type DiagnosticsResult =
  | {
      ok: true;
      report: DiagnosticsReport;
    }
  | ErrorResult;

export type SessionMessage =
  | { type: "session.getState" }
  | { type: "session.start" }
  | { type: "session.stop" };

export type ScenarioListResult =
  | { ok: true; scenarios: string[] }
  | ErrorResult;
export type ScenarioResult = { ok: true; name: string } | ErrorResult;

export type BackgroundMessage =
  | SessionMessage
  | { type: "diagnostics.getReport" }
  | { type: "config.readConfiguredSiteConfigs" }
  | { type: "config.readEffectiveSiteConfigs" }
  | { type: "config.writeConfiguredSiteConfigs"; siteConfigs: SiteConfig[] }
  | { type: "root.verify" }
  | { type: "native.verify" }
  | { type: "native.open"; commandTemplate?: string; editorId?: string }
  | { type: "native.revealRoot" }
  | { type: "scenario.list" }
  | { type: "scenario.save"; name: string }
  | { type: "scenario.switch"; name: string };

export interface FixtureResponsePayload {
  body: string;
  bodyEncoding: "utf8" | "base64";
  meta: ResponseMeta;
}

export type OffscreenMessage =
  | {
      target: "offscreen";
      type: "fs.ensureRoot";
      payload?: { requestPermission?: boolean };
    }
  | {
      target: "offscreen";
      type: "fs.readConfiguredSiteConfigs";
      payload?: undefined;
    }
  | {
      target: "offscreen";
      type: "fs.readEffectiveSiteConfigs";
      payload?: undefined;
    }
  | {
      target: "offscreen";
      type: "fs.writeConfiguredSiteConfigs";
      payload: {
        siteConfigs: SiteConfig[];
      };
    }
  | {
      target: "offscreen";
      type: "fs.hasFixture";
      payload: { descriptor: FixtureDescriptor };
    }
  | {
      target: "offscreen";
      type: "fs.readFixture";
      payload: { descriptor: FixtureDescriptor };
    }
  | {
      target: "offscreen";
      type: "fs.writeFixture";
      payload: {
        descriptor: FixtureDescriptor;
        request: RequestPayload;
        response: FixtureResponsePayload;
      };
    }
  | {
      target: "offscreen";
      type: "fs.generateContext";
      payload: {
        siteConfigs: SiteConfig[];
        editorId?: string;
      };
    };

export type BackgroundMessageResult =
  | SessionSnapshot
  | DiagnosticsResult
  | RootReadyResult
  | SiteConfigsResult
  | NativeVerifyResult
  | NativeOpenResult
  | ScenarioListResult
  | ScenarioResult
  | undefined;

export type FixtureHasResult =
  | {
      ok: true;
      exists: boolean;
    }
  | ErrorResult;

export type FixtureReadResult =
  | {
      ok: true;
      exists: false;
    }
  | {
      ok: true;
      exists: true;
      request: RequestPayload;
      meta: ResponseMeta;
      bodyBase64: string;
      size: number;
      sentinel: RootSentinel;
    }
  | ErrorResult;

export type FixtureWriteResult =
  | {
      ok: true;
      descriptor: FixtureDescriptor;
      sentinel: RootSentinel;
    }
  | ErrorResult;

export type SiteConfigsResult =
  | {
      ok: true;
      siteConfigs: SiteConfig[];
      sentinel: RootSentinel;
    }
  | ErrorResult;
