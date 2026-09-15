import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import {
  createStaticResourceManifest,
  createStaticResourceManifestEntry,
  getStaticResourceManifestPath,
  upsertStaticResourceManifest,
  type FixtureDescriptor,
  type RequestPayload,
  type ResponseMeta,
  type StaticResourceManifest
} from "@wraithwalker/core/fixture-layout";
import type { RootSentinel } from "@wraithwalker/core/root";
import { createFixtureRootFs } from "@wraithwalker/core/root-fs";
import { z } from "zod";

import {
  fixtureDescriptorSchema,
  requestPayloadSchema,
  responseMetaSchema
} from "./trpc.mjs";

const MAX_STREAM_ENVELOPE_BYTES = 1024 * 1024;

const streamFixtureEnvelopeSchema = z.object({
  descriptor: fixtureDescriptorSchema,
  request: requestPayloadSchema,
  response: z.object({
    bodyEncoding: z.union([z.literal("utf8"), z.literal("base64")]),
    meta: responseMetaSchema
  })
});

type StreamFixtureEnvelope = z.infer<typeof streamFixtureEnvelopeSchema>;

interface WriteFixtureUploadStreamOptions {
  rootPath: string;
  sentinel: RootSentinel;
  source: AsyncIterable<Uint8Array | Buffer>;
}

interface StreamTarget {
  bodyExists: boolean;
  bodyAbsolutePath: string;
  tempBodyPath: string | null;
  tempAbsolutePath: string | null;
  handle: FileHandle | null;
}

function toBuffer(chunk: Uint8Array | Buffer): Buffer {
  return Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

function parseEnvelope(buffer: Buffer): StreamFixtureEnvelope {
  return streamFixtureEnvelopeSchema.parse(JSON.parse(buffer.toString("utf8")));
}

function requireResolvedPath(
  relativePath: string,
  absolutePath: string | null
) {
  if (!absolutePath) {
    throw new Error(
      `Path "${relativePath}" must stay within the fixture root.`
    );
  }

  return absolutePath;
}

async function writeJsonIfMissing(
  rootFs: ReturnType<typeof createFixtureRootFs>,
  relativePath: string,
  value: unknown
): Promise<boolean> {
  if (await rootFs.exists(relativePath)) {
    return false;
  }

  await rootFs.writeJson(relativePath, value);
  return true;
}

async function createStreamTarget(
  rootFs: ReturnType<typeof createFixtureRootFs>,
  descriptor: FixtureDescriptor
): Promise<StreamTarget> {
  const bodyExists = await rootFs.exists(descriptor.bodyPath);
  const bodyAbsolutePath = requireResolvedPath(
    descriptor.bodyPath,
    rootFs.resolve(descriptor.bodyPath)
  );

  if (bodyExists) {
    return {
      bodyExists,
      bodyAbsolutePath,
      tempBodyPath: null,
      tempAbsolutePath: null,
      handle: null
    };
  }

  const tempBodyPath = `${descriptor.bodyPath}.__stream-${randomUUID()}.tmp`;
  const tempAbsolutePath = requireResolvedPath(
    tempBodyPath,
    rootFs.resolve(tempBodyPath)
  );
  await fs.mkdir(path.dirname(tempAbsolutePath), { recursive: true });

  return {
    bodyExists,
    bodyAbsolutePath,
    tempBodyPath,
    tempAbsolutePath,
    handle: await fs.open(tempAbsolutePath, "w")
  };
}

async function writeManifestIfNeeded({
  rootFs,
  descriptor,
  meta,
  canonicalBodySha256,
  sidecarWritten
}: {
  rootFs: ReturnType<typeof createFixtureRootFs>;
  descriptor: FixtureDescriptor;
  meta: ResponseMeta;
  canonicalBodySha256?: string;
  sidecarWritten: boolean;
}): Promise<boolean> {
  if (!descriptor.assetLike || !sidecarWritten) {
    return false;
  }

  const manifestPath = getStaticResourceManifestPath(descriptor);
  if (!manifestPath) {
    return false;
  }

  const currentManifest =
    await rootFs.readOptionalJson<StaticResourceManifest>(manifestPath);
  const projectionPath =
    descriptor.projectionPath &&
    (await rootFs.exists(descriptor.projectionPath))
      ? descriptor.projectionPath
      : null;
  const nextManifest = upsertStaticResourceManifest(
    currentManifest || createStaticResourceManifest(descriptor),
    createStaticResourceManifestEntry(descriptor, meta, {
      projectionPath,
      canonicalBodySha256
    })
  );

  await rootFs.writeJson(manifestPath, nextManifest);
  return true;
}

export async function writeFixtureUploadStream({
  rootPath,
  sentinel,
  source
}: WriteFixtureUploadStreamOptions): Promise<{
  written: boolean;
  descriptor: FixtureDescriptor;
  sentinel: RootSentinel;
}> {
  const rootFs = createFixtureRootFs(rootPath);
  const hash = createHash("sha256");
  let envelopeBuffer = Buffer.alloc(0);
  let envelope: StreamFixtureEnvelope | null = null;
  let target: StreamTarget | null = null;

  async function initializeEnvelope(buffer: Buffer) {
    envelope = parseEnvelope(buffer);
    target = await createStreamTarget(
      rootFs,
      envelope.descriptor as FixtureDescriptor
    );
  }

  async function consumeBody(buffer: Buffer) {
    if (!target || buffer.byteLength === 0) {
      return;
    }

    hash.update(buffer);
    if (target.handle) {
      await target.handle.write(buffer);
    }
  }

  try {
    for await (const rawChunk of source) {
      const chunk = toBuffer(rawChunk);
      if (envelope) {
        await consumeBody(chunk);
        continue;
      }

      const newlineIndex = chunk.indexOf(0x0a);
      if (newlineIndex === -1) {
        envelopeBuffer = Buffer.concat([envelopeBuffer, chunk]);
        if (envelopeBuffer.byteLength > MAX_STREAM_ENVELOPE_BYTES) {
          throw new Error("Fixture upload envelope is too large.");
        }
        continue;
      }

      const envelopeChunk = chunk.subarray(0, newlineIndex);
      envelopeBuffer = Buffer.concat([envelopeBuffer, envelopeChunk]);
      if (envelopeBuffer.byteLength > MAX_STREAM_ENVELOPE_BYTES) {
        throw new Error("Fixture upload envelope is too large.");
      }

      await initializeEnvelope(envelopeBuffer);
      await consumeBody(chunk.subarray(newlineIndex + 1));
    }

    if (!envelope || !target) {
      throw new Error("Fixture upload envelope is missing.");
    }

    if (target.handle) {
      await target.handle.close();
      target.handle = null;
      await fs.mkdir(path.dirname(target.bodyAbsolutePath), {
        recursive: true
      });
      await fs.rename(target.tempAbsolutePath!, target.bodyAbsolutePath);
    }

    const descriptor = envelope.descriptor as FixtureDescriptor;
    const request = envelope.request as RequestPayload;
    const meta = envelope.response.meta as ResponseMeta;
    const bodyWritten = !target.bodyExists;
    const canonicalBodySha256 = descriptor.assetLike
      ? hash.digest("hex")
      : undefined;
    const requestWritten = await writeJsonIfMissing(
      rootFs,
      descriptor.requestPath,
      request
    );
    const metaWritten = await writeJsonIfMissing(
      rootFs,
      descriptor.metaPath,
      meta
    );
    const sidecarWritten = bodyWritten || requestWritten || metaWritten;
    const manifestWritten = await writeManifestIfNeeded({
      rootFs,
      descriptor,
      meta,
      canonicalBodySha256,
      sidecarWritten
    });

    return {
      written: sidecarWritten || manifestWritten,
      descriptor,
      sentinel
    };
  } catch (error) {
    if (target?.handle) {
      await target.handle.close().catch(() => {});
    }
    if (target?.tempAbsolutePath) {
      await fs.rm(target.tempAbsolutePath, { force: true }).catch(() => {});
    }

    throw error;
  }
}
