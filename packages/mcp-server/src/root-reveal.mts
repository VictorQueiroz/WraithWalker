import * as childProcess from "node:child_process";

import { readSentinel } from "@wraithwalker/core/root";

export type SpawnLike = typeof childProcess.spawn;

export function spawnDetached(
  command: string,
  args: string[],
  spawnFn: SpawnLike = childProcess.spawn
): void {
  const child = spawnFn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

export function getRevealRootLaunch(
  rootPath: string,
  platform: NodeJS.Platform = process.platform
): { command: string; program: string; args: string[] } {
  if (platform === "darwin") {
    return {
      command: `open '${rootPath.replace(/'/g, `'\\''`)}'`,
      program: "open",
      args: [rootPath]
    };
  }

  if (platform === "win32") {
    return {
      command: `cmd /c start "" '${rootPath.replace(/'/g, `'\\''`)}'`,
      program: "cmd",
      args: ["/c", "start", "", rootPath]
    };
  }

  return {
    command: `xdg-open '${rootPath.replace(/'/g, `'\\''`)}'`,
    program: "xdg-open",
    args: [rootPath]
  };
}

export async function revealRootDirectory(
  {
    rootPath,
    expectedRootId
  }: {
    rootPath: string;
    expectedRootId: string;
  },
  spawnFn: SpawnLike = childProcess.spawn
): Promise<{ ok: true; command: string }> {
  const sentinel = await readSentinel(rootPath);
  if (sentinel.rootId !== expectedRootId) {
    throw new Error(
      `Sentinel root ID mismatch. Expected ${expectedRootId}, received ${sentinel.rootId}.`
    );
  }

  const launch = getRevealRootLaunch(rootPath);
  spawnDetached(launch.program, launch.args, spawnFn);
  return { ok: true, command: launch.command };
}
