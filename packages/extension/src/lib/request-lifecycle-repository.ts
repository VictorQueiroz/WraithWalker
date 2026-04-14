import type { FixtureDescriptor, RequestPayload, ResponseMeta, StoredFixture } from "./types.js";
import type {
  FixtureCheckResponse,
  FixtureReadResponse,
  RequestLifecycleRepository
} from "./request-lifecycle-shared.js";

export function createDefaultRequestLifecycleRepository({
  sendOffscreenMessage
}: {
  sendOffscreenMessage: <T = unknown>(type: string, payload?: Record<string, unknown>) => Promise<T>;
}): RequestLifecycleRepository {
  return {
    async exists(descriptor: FixtureDescriptor): Promise<boolean> {
      const fixtureCheck = await sendOffscreenMessage<FixtureCheckResponse>("fs.hasFixture", { descriptor });
      if (!fixtureCheck.ok) {
        throw new Error(fixtureCheck.error || "Fixture lookup failed.");
      }

      return Boolean(fixtureCheck.exists);
    },
    async read(descriptor: FixtureDescriptor): Promise<StoredFixture | null> {
      const fixture = await sendOffscreenMessage<FixtureReadResponse>("fs.readFixture", { descriptor });
      if (!fixture.ok) {
        throw new Error(fixture.error || "Fixture lookup failed.");
      }

      if (!fixture.exists || !fixture.meta || !fixture.bodyBase64 || !fixture.request) {
        return null;
      }

      return {
        request: fixture.request,
        meta: fixture.meta,
        bodyBase64: fixture.bodyBase64,
        size: fixture.size || 0
      };
    },
    async writeIfAbsent(payload: {
      descriptor: FixtureDescriptor;
      request: RequestPayload;
      response: {
        body: string;
        bodyEncoding: "utf8" | "base64";
        meta: ResponseMeta;
      };
    }): Promise<unknown> {
      const result = await sendOffscreenMessage<{
        ok: boolean;
        error?: string;
      }>("fs.writeFixture", payload as unknown as Record<string, unknown>);
      if (!result.ok) {
        throw new Error(result.error || "Fixture write failed.");
      }

      return result;
    }
  };
}
