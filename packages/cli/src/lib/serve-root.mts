import os from "node:os";
import path from "node:path";

function resolveMaybeRelative(cwd: string, value: string): string {
  return path.isAbsolute(value)
    ? value
    : path.resolve(cwd, value);
}

export function resolveDefaultServeRoot({
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir()
}: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
} = {}): string {
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "WraithWalker", "content");
  }

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim()
      ? env.LOCALAPPDATA
      : path.join(homeDir, "AppData", "Local");
    return path.join(localAppData, "WraithWalker", "content");
  }

  const xdgDataHome = env.XDG_DATA_HOME?.trim()
    ? env.XDG_DATA_HOME
    : path.join(homeDir, ".local", "share");
  return path.join(xdgDataHome, "wraithwalker", "content");
}

export function resolveServeRoot({
  cwd,
  explicitDir,
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir()
}: {
  cwd: string;
  explicitDir?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
}): string {
  if (explicitDir) {
    return resolveMaybeRelative(cwd, explicitDir);
  }

  const envRoot = env.WRAITHWALKER_ROOT?.trim();
  if (envRoot) {
    return resolveMaybeRelative(cwd, envRoot);
  }

  return resolveDefaultServeRoot({ env, platform, homeDir });
}
