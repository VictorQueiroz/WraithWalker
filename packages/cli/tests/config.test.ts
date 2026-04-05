import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  getGlobalConfigPath,
  getProjectConfigPath,
  loadGlobalCliConfig,
  loadProjectCliConfig,
  mergeCliConfigs,
  resolveCliConfig
} from "../src/lib/cli-config.mts";

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-cli-config-"));
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

describe("cli config", () => {
  it("uses the built-in theme by default", () => {
    const resolved = resolveCliConfig({});
    expect(resolved.theme.name).toBe("wraithwalker");
  });

  it("loads global config from the linux XDG location", async () => {
    const homeDir = await tmpdir();
    const configPath = getGlobalConfigPath({ platform: "linux", env: {}, homeDir });
    await writeJson(configPath, {
      theme: {
        overrides: {
          indent: ">> "
        }
      }
    });

    const config = await loadGlobalCliConfig({ platform: "linux", env: {}, homeDir });
    expect(resolveCliConfig(config).theme.indent).toBe(">> ");
  });

  it("loads project config from the fixture root", async () => {
    const rootPath = await tmpdir();
    const configPath = getProjectConfigPath(rootPath);
    await writeJson(configPath, {
      theme: {
        overrides: {
          labelWidth: 20
        }
      }
    });

    const config = await loadProjectCliConfig(rootPath);
    expect(resolveCliConfig(config).theme.labelWidth).toBe(20);
  });

  it("merges global and project theme overrides with project precedence", () => {
    const merged = mergeCliConfigs(
      {
        theme: {
          overrides: {
            indent: "g ",
            styles: {
              heading: ["bold", "magenta"]
            }
          }
        }
      },
      {
        theme: {
          overrides: {
            indent: "p ",
            icons: {
              bullet: "•"
            }
          }
        }
      }
    );

    const resolved = resolveCliConfig(merged);
    expect(resolved.theme.indent).toBe("p ");
    expect(resolved.theme.styles.heading).toEqual(["bold", "magenta"]);
    expect(resolved.theme.icons.bullet).toBe("•");
  });

  it("reports invalid JSON with the file path", async () => {
    const homeDir = await tmpdir();
    const configPath = getGlobalConfigPath({ platform: "linux", env: {}, homeDir });
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, "{not-json", "utf8");

    await expect(loadGlobalCliConfig({ platform: "linux", env: {}, homeDir })).rejects.toThrow(configPath);
  });

  it("reports unknown theme names with the file path", async () => {
    const homeDir = await tmpdir();
    const configPath = getGlobalConfigPath({ platform: "linux", env: {}, homeDir });
    await writeJson(configPath, {
      theme: {
        name: "ghost-theme"
      }
    });

    await expect(loadGlobalCliConfig({ platform: "linux", env: {}, homeDir })).rejects.toThrow(configPath);
  });
});
