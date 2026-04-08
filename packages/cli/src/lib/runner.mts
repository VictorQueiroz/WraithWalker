import { findRoot } from "@wraithwalker/core/root";
import type { CommandContext, CommandSpec } from "./command.mjs";
import { UsageError } from "./command.mjs";
import { loadGlobalCliConfig, loadProjectCliConfig, mergeCliConfigs, resolveCliConfig } from "./cli-config.mjs";
import { supportsColor } from "./ansi.mjs";
import { createPlainOutput } from "./plain-output.mjs";
import { createThemedOutput } from "./themed-output.mjs";
import { command as contextCommand } from "../commands/context.mjs";
import { command as configCommand } from "../commands/config.mjs";
import { command as importHarCommand } from "../commands/import-har.mjs";
import { command as initCommand } from "../commands/init.mjs";
import { command as scenariosCommand } from "../commands/scenarios.mjs";
import { command as serveCommand } from "../commands/serve.mjs";
import { command as statusCommand } from "../commands/status.mjs";
import { command as syncCommand } from "../commands/sync.mjs";

const COMMANDS: CommandSpec<unknown, unknown>[] = [
  initCommand,
  configCommand,
  syncCommand,
  importHarCommand,
  statusCommand,
  contextCommand,
  scenariosCommand,
  serveCommand
];

const COMMAND_MAP = new Map(COMMANDS.map((command) => [command.name, command]));

export const USAGE = `Usage: wraithwalker <command>

Commands:
  init [dir]                     Create a fixture root (.wraithwalker/root.json)
  config {list|get|set|add|unset} Manage nearest-root capture config
  sync [dir]                     Populate or refresh .wraithwalker metadata
  import-har <har-file> [dir]    Populate a fixture root from a HAR file
  status                         Show fixture root summary
  context [--editor <id>]        Regenerate CLAUDE.md and .d.ts types
  scenarios list                 List saved scenarios
  scenarios save <name>          Save current fixtures as a scenario
  scenarios switch <name>        Switch to a saved scenario
  scenarios diff <a> <b>         Compare two scenarios
  serve [dir] [--http] [--host <host>] [--port <port>] Start the MCP+tRPC HTTP server`;

function createOutput(
  cliConfig: CommandContext["cliConfig"],
  { env = process.env, isTTY = process.stdout.isTTY }: { env?: NodeJS.ProcessEnv; isTTY?: boolean } = {}
) {
  return supportsColor({ env, isTTY })
    ? createThemedOutput(cliConfig.theme, { isTTY })
    : createPlainOutput(cliConfig.theme);
}

export async function runCli(
  argv: string[],
  {
    cwd = process.cwd(),
    env = process.env,
    isTTY = process.stdout.isTTY,
    platform = process.platform,
    homeDir
  }: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    isTTY?: boolean;
    platform?: NodeJS.Platform;
    homeDir?: string;
  } = {}
): Promise<number> {
  const globalConfigFile = await loadGlobalCliConfig({ env, platform, homeDir });
  const globalConfig = resolveCliConfig(globalConfigFile);
  let output = createOutput(globalConfig, { env, isTTY });
  const [commandName, ...rest] = argv;

  if (commandName === undefined || commandName === "--help" || commandName === "-h") {
    output.banner();
    output.usage(USAGE);
    return 0;
  }

  const command = COMMAND_MAP.get(commandName);
  if (!command) {
    output.error(`Unknown command: ${commandName}`);
    output.usage(USAGE);
    return 1;
  }

  try {
    const parsedArgs = command.parse(rest);
    let cliConfig = globalConfig;

    if (command.requiresRoot) {
      const { rootPath } = await findRoot(cwd);
      cliConfig = resolveCliConfig(mergeCliConfigs(
        globalConfigFile,
        await loadProjectCliConfig(rootPath)
      ));
      output = createOutput(cliConfig, { env, isTTY });
    }

    const context: CommandContext = {
      cwd,
      env,
      platform,
      homeDir,
      output,
      cliConfig
    };

    const result = await command.execute(context, parsedArgs as never);
    command.render(output, result as never);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      output.usage(error.message);
      return 1;
    }

    output.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
