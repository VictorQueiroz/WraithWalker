import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

import { type ResponseMeta } from "./fixture-layout.mjs";
import { createFixtureRootFs, resolveWithinRoot } from "./root-fs.mjs";
import {
  DEFAULT_READ_MAX_BYTES,
  DEFAULT_SNIPPET_LINE_COUNT,
  DEFAULT_SNIPPET_MAX_BYTES,
  MAX_READ_MAX_BYTES,
  MAX_SNIPPET_LINE_COUNT,
  MAX_SNIPPET_MAX_BYTES,
  normalizeLimit
} from "./fixtures-shared.mjs";
import type {
  ApiFixture,
  FixtureReadOptions,
  FixtureReadPage,
  FixtureSnippet,
  FixtureSnippetOptions
} from "./fixtures-types.mjs";

const MIN_UTF8_PAGE_BYTES = 4;

function encodeReadCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeReadCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }

  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const offset = Number(value.offset);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error("invalid offset");
    }
    return offset;
  } catch {
    throw new Error(`Invalid read cursor: ${cursor}`);
  }
}

function createFixtureReadError(
  relativePath: string,
  reason: "invalid-path" | "missing" | "binary"
): Error {
  switch (reason) {
    case "invalid-path":
      return new Error(
        `Invalid fixture path: ${relativePath}. Paths must stay within the fixture root.`
      );
    case "missing":
      return new Error(`File not found: ${relativePath}`);
    case "binary":
      return new Error(`Fixture is not a text file: ${relativePath}`);
  }
}

function utf8SequenceLength(leadByte: number): number {
  if ((leadByte & 0b1000_0000) === 0) {
    return 1;
  }
  if ((leadByte & 0b1110_0000) === 0b1100_0000) {
    return 2;
  }
  if ((leadByte & 0b1111_0000) === 0b1110_0000) {
    return 3;
  }
  if ((leadByte & 0b1111_1000) === 0b1111_0000) {
    return 4;
  }
  return 0;
}

function isUtf8Continuation(byte: number): boolean {
  return (byte & 0b1100_0000) === 0b1000_0000;
}

function findUtf8SafeEnd(buffer: Buffer, maxBytes: number): number {
  const desiredEnd = Math.min(buffer.length, maxBytes);
  if (desiredEnd === 0 || desiredEnd === buffer.length) {
    return desiredEnd;
  }

  let leadIndex = desiredEnd - 1;
  while (leadIndex >= 0 && isUtf8Continuation(buffer[leadIndex])) {
    leadIndex -= 1;
  }

  if (leadIndex < 0) {
    return 0;
  }

  const sequenceLength = utf8SequenceLength(buffer[leadIndex]);
  if (sequenceLength > 1 && leadIndex + sequenceLength > desiredEnd) {
    return leadIndex;
  }

  return desiredEnd;
}

async function readFilePage(
  absolutePath: string,
  relativePath: string,
  sizeBytes: number,
  options: FixtureReadOptions = {}
): Promise<FixtureReadPage> {
  const maxBytes = normalizeLimit(
    options.maxBytes,
    DEFAULT_READ_MAX_BYTES,
    MAX_READ_MAX_BYTES
  );
  const effectiveMaxBytes = Math.max(maxBytes, MIN_UTF8_PAGE_BYTES);
  const startByte = decodeReadCursor(options.cursor);
  if (startByte > sizeBytes) {
    throw new Error(`Invalid read cursor: ${options.cursor}`);
  }

  const bytesAvailable = sizeBytes - startByte;
  const readCapacity = Math.min(bytesAvailable, effectiveMaxBytes + 4);
  const buffer = Buffer.alloc(readCapacity);
  let bytesRead = 0;

  if (readCapacity > 0) {
    const handle = await fs.open(absolutePath, "r");
    try {
      const readResult = await handle.read(buffer, 0, readCapacity, startByte);
      bytesRead = readResult.bytesRead;
    } finally {
      await handle.close();
    }
  }

  const readBuffer = buffer.subarray(0, bytesRead);
  if (readBuffer.includes(0)) {
    throw createFixtureReadError(relativePath, "binary");
  }

  const bytesReturned = findUtf8SafeEnd(readBuffer, effectiveMaxBytes);
  if (bytesRead > 0 && bytesReturned === 0) {
    throw createFixtureReadError(relativePath, "binary");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      readBuffer.subarray(0, bytesReturned)
    );
  } catch {
    throw createFixtureReadError(relativePath, "binary");
  }

  const nextByte = startByte + bytesReturned;
  const truncated = nextByte < sizeBytes;

  return {
    path: relativePath,
    sizeBytes,
    startByte,
    bytesReturned,
    maxBytes: effectiveMaxBytes,
    truncated,
    nextCursor: truncated ? encodeReadCursor(nextByte) : null,
    text
  };
}

async function readFixturePage(
  rootPath: string,
  relativePath: string,
  options: FixtureReadOptions = {}
): Promise<FixtureReadPage | null> {
  const absolutePath = resolveWithinRoot(rootPath, relativePath);
  if (!absolutePath) {
    return null;
  }

  const rootFs = createFixtureRootFs(rootPath);
  const stat = await rootFs.stat(relativePath);
  if (!stat?.isFile()) {
    return null;
  }

  return readFilePage(absolutePath, relativePath, stat.size, options);
}

function appendUtf8Bounded(
  currentText: string,
  nextText: string,
  maxBytes: number
): { text: string; truncated: boolean } {
  const currentBytes = Buffer.byteLength(currentText, "utf8");
  const remainingBytes = maxBytes - currentBytes;
  if (remainingBytes <= 0) {
    return { text: currentText, truncated: nextText.length > 0 };
  }

  const nextBytes = Buffer.byteLength(nextText, "utf8");
  if (nextBytes <= remainingBytes) {
    return { text: `${currentText}${nextText}`, truncated: false };
  }

  const buffer = Buffer.from(nextText, "utf8");
  const bytesToAppend = findUtf8SafeEnd(buffer, remainingBytes);
  return {
    text: `${currentText}${buffer.subarray(0, bytesToAppend).toString("utf8")}`,
    truncated: true
  };
}

async function readFixtureSnippetStreaming(
  rootPath: string,
  relativePath: string,
  {
    startLine,
    lineCount,
    maxBytes
  }: {
    startLine: number;
    lineCount: number;
    maxBytes: number;
  }
): Promise<FixtureSnippet> {
  const absolutePath = resolveWithinRoot(rootPath, relativePath);
  if (!absolutePath) {
    throw createFixtureReadError(relativePath, "invalid-path");
  }

  const rootFs = createFixtureRootFs(rootPath);
  const stat = await rootFs.stat(relativePath);
  if (!stat?.isFile()) {
    throw createFixtureReadError(relativePath, "missing");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const stream = createReadStream(absolutePath, {
    highWaterMark: 64 * 1024
  });
  const endExclusive = startLine + lineCount;
  let currentLine = 1;
  let lastIncludedLine = startLine - 1;
  let text = "";
  let truncated = false;
  let previousWasCr = false;

  const appendIfSelected = (value: string): void => {
    if (currentLine < startLine || currentLine >= endExclusive || truncated) {
      return;
    }

    const appended = appendUtf8Bounded(text, value, maxBytes);
    text = appended.text;
    truncated = appended.truncated;
    if (value.length > 0) {
      lastIncludedLine = currentLine;
    }
  };

  const advanceLine = (lineEnding: "\n" | "\r"): void => {
    if (currentLine >= startLine && currentLine < endExclusive) {
      lastIncludedLine = currentLine;
      if (currentLine + 1 < endExclusive) {
        appendIfSelected("\n");
      }
    }

    currentLine += 1;
    previousWasCr = lineEnding === "\r";
  };

  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buffer.includes(0)) {
        throw createFixtureReadError(relativePath, "binary");
      }

      const decoded = decoder.decode(buffer, { stream: true });
      for (const char of decoded) {
        if (char === "\n") {
          if (previousWasCr) {
            previousWasCr = false;
            continue;
          }
          advanceLine("\n");
        } else if (char === "\r") {
          advanceLine("\r");
        } else {
          previousWasCr = false;
          appendIfSelected(char);
        }

        if (truncated || currentLine >= endExclusive) {
          stream.destroy();
          break;
        }
      }

      if (truncated || currentLine >= endExclusive) {
        break;
      }
    }

    const tail = decoder.decode();
    for (const char of tail) {
      if (char === "\n") {
        if (previousWasCr) {
          previousWasCr = false;
          continue;
        }
        advanceLine("\n");
      } else if (char === "\r") {
        advanceLine("\r");
      } else {
        previousWasCr = false;
        appendIfSelected(char);
      }

      if (truncated || currentLine >= endExclusive) {
        break;
      }
    }
  } catch (error) {
    stream.destroy();
    if (error instanceof Error && error.message.startsWith("Fixture is not")) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw createFixtureReadError(relativePath, "binary");
    }
    throw error;
  }

  return {
    path: relativePath,
    startLine,
    endLine: text === "" ? startLine - 1 : lastIncludedLine,
    truncated,
    text
  };
}

export function resolveFixturePath(
  rootPath: string,
  relativePath: string
): string | null {
  return resolveWithinRoot(rootPath, relativePath);
}

export async function readFixtureBody(
  rootPath: string,
  relativePath: string,
  options: FixtureReadOptions = {}
): Promise<FixtureReadPage | null> {
  return readFixturePage(rootPath, relativePath, options);
}

export async function readFixtureSnippet(
  rootPath: string,
  relativePath: string,
  options: FixtureSnippetOptions = {}
): Promise<FixtureSnippet> {
  const startLine = Math.max(1, Math.trunc(options.startLine ?? 1));
  const lineCount = normalizeLimit(
    options.lineCount,
    DEFAULT_SNIPPET_LINE_COUNT,
    MAX_SNIPPET_LINE_COUNT
  );
  const maxBytes = normalizeLimit(
    options.maxBytes,
    DEFAULT_SNIPPET_MAX_BYTES,
    MAX_SNIPPET_MAX_BYTES
  );

  return readFixtureSnippetStreaming(rootPath, relativePath, {
    startLine,
    lineCount,
    maxBytes
  });
}

export async function readApiFixture(
  rootPath: string,
  fixtureDir: string,
  options: FixtureReadOptions = {}
): Promise<ApiFixture | null> {
  const rootFs = createFixtureRootFs(rootPath);
  const metaPath = path.join(fixtureDir, "response.meta.json");
  const bodyPath = path.join(fixtureDir, "response.body");

  if (!rootFs.resolve(metaPath) || !rootFs.resolve(bodyPath)) {
    return null;
  }

  const meta = await rootFs.readOptionalJson<ResponseMeta>(metaPath);
  if (!meta) {
    return null;
  }

  return {
    fixtureDir,
    metaPath,
    bodyPath,
    meta,
    body: await readFixtureBody(rootPath, bodyPath, options)
  };
}
