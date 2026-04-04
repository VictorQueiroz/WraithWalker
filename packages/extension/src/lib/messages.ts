import type { FixtureDescriptor, RequestPayload, ResponseMeta, RootSentinel, SessionSnapshot, SiteConfig } from "./types.js";

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

export type SessionMessage =
  | { type: "session.getState" }
  | { type: "session.start" }
  | { type: "session.stop" };

export type ScenarioListResult = { ok: true; scenarios: string[] } | ErrorResult;
export type ScenarioResult = { ok: true; name: string } | ErrorResult;

export type BackgroundMessage =
  | SessionMessage
  | { type: "root.verify" }
  | { type: "native.verify" }
  | { type: "native.open"; commandTemplate?: string; editorId?: string }
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
  | RootReadyResult
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
