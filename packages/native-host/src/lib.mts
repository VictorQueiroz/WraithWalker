import * as childProcess from "node:child_process";
import {
  listScenarios as listScenarioNames,
  saveScenario as coreSaveScenario,
  switchScenario as coreSwitchScenario
} from "@wraithwalker/core/scenarios";
import { readSentinel, type RootSentinel } from "@wraithwalker/core/root";

export { readSentinel };

export interface VerifyRootMessage {
  path?: string;
  expectedRootId?: string;
}

export interface OpenDirectoryMessage extends VerifyRootMessage {
  commandTemplate?: string;
}

export interface ScenarioMessage extends VerifyRootMessage {
  name?: string;
}

export type SpawnLike = typeof childProcess.spawn;

export function spawnDetached(command: string, args: string[], spawnFn: SpawnLike = childProcess.spawn): void {
  const child = spawnFn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export async function verifyRoot({ path: rootPath, expectedRootId }: VerifyRootMessage): Promise<{ ok: true; sentinel: RootSentinel }> {
  if (!rootPath) {
    throw new Error("Root path is required.");
  }

  if (!expectedRootId) {
    throw new Error("Expected root ID is required.");
  }

  const sentinel = await readSentinel(rootPath);
  if (sentinel.rootId !== expectedRootId) {
    throw new Error(`Sentinel root ID mismatch. Expected ${expectedRootId}, received ${sentinel.rootId}.`);
  }

  return { ok: true, sentinel };
}

export function substituteDirectory(commandTemplate: string | undefined, rootPath: string): string {
  if (!commandTemplate) {
    throw new Error("Command template is required.");
  }

  if (!commandTemplate.includes("$DIR")) {
    return `${commandTemplate} ${shellQuote(rootPath)}`;
  }

  return commandTemplate
    .replace(/"\$DIR"/g, shellQuote(rootPath))
    .replace(/'\$DIR'/g, shellQuote(rootPath))
    .replace(/\$DIR/g, shellQuote(rootPath));
}

export async function openDirectory({
  path: rootPath,
  expectedRootId,
  commandTemplate
}: OpenDirectoryMessage): Promise<{ ok: true; command: string }> {
  await verifyRoot({ path: rootPath, expectedRootId });
  const command = substituteDirectory(commandTemplate, rootPath as string);

  const child = childProcess.spawn("/bin/sh", ["-lc", command], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  return { ok: true, command };
}

export function getRevealDirectoryCommand(rootPath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") {
    return `open ${shellQuote(rootPath)}`;
  }

  if (platform === "win32") {
    return `cmd /c start \"\" ${shellQuote(rootPath)}`;
  }

  return `xdg-open ${shellQuote(rootPath)}`;
}

export function getRevealDirectoryLaunch(
  rootPath: string,
  platform: NodeJS.Platform = process.platform
): { command: string; program: string; args: string[] } {
  if (platform === "darwin") {
    return {
      command: getRevealDirectoryCommand(rootPath, platform),
      program: "open",
      args: [rootPath]
    };
  }

  if (platform === "win32") {
    return {
      command: getRevealDirectoryCommand(rootPath, platform),
      program: "cmd",
      args: ["/c", "start", "", rootPath]
    };
  }

  return {
    command: getRevealDirectoryCommand(rootPath, platform),
    program: "xdg-open",
    args: [rootPath]
  };
}

export async function revealDirectory(
  { path: rootPath, expectedRootId }: VerifyRootMessage,
  spawnFn: SpawnLike = childProcess.spawn
): Promise<{ ok: true; command: string }> {
  await verifyRoot({ path: rootPath, expectedRootId });
  const launch = getRevealDirectoryLaunch(rootPath as string);
  spawnDetached(launch.program, launch.args, spawnFn);
  return { ok: true, command: launch.command };
}

export async function saveScenario({ path: rootPath, expectedRootId, name }: ScenarioMessage): Promise<{ ok: true; name: string }> {
  return coreSaveScenario({ path: rootPath, expectedRootId, name });
}

export async function switchScenario({ path: rootPath, expectedRootId, name }: ScenarioMessage): Promise<{ ok: true; name: string }> {
  return coreSwitchScenario({ path: rootPath, expectedRootId, name });
}

export async function listScenarios({ path: rootPath, expectedRootId }: VerifyRootMessage): Promise<{ ok: true; scenarios: string[] }> {
  await verifyRoot({ path: rootPath, expectedRootId });
  return { ok: true, scenarios: await listScenarioNames(rootPath as string) };
}
