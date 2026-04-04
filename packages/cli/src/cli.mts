#!/usr/bin/env node

import process from "node:process";
import { supportsColor } from "./lib/ansi.mjs";
import { createThemedOutput } from "./lib/themed-output.mjs";
import { createPlainOutput } from "./lib/plain-output.mjs";
import { wraithwalkerTheme } from "./lib/wraithwalker-theme.mjs";

const USAGE = `Usage: wraithwalker <command>

Commands:
  init [dir]                     Create a fixture root (.wraithwalker/root.json)
  status                         Show fixture root summary
  context [--editor <id>]        Regenerate CLAUDE.md and .d.ts types
  scenarios list                 List saved scenarios
  scenarios save <name>          Save current fixtures as a scenario
  scenarios switch <name>        Switch to a saved scenario
  scenarios diff <a> <b>         Compare two scenarios
  serve                          Start the MCP server`;

const output = supportsColor() ? createThemedOutput(wraithwalkerTheme) : createPlainOutput();
const [command, ...rest] = process.argv.slice(2);

try {
  switch (command) {
    case "init":
      await (await import("./commands/init.mjs")).run(rest, output);
      break;
    case "status":
      await (await import("./commands/status.mjs")).run(rest, output);
      break;
    case "context":
      await (await import("./commands/context.mjs")).run(rest, output);
      break;
    case "scenarios":
      await (await import("./commands/scenarios.mjs")).run(rest, output);
      break;
    case "serve":
      await (await import("./commands/serve.mjs")).run(rest, output);
      break;
    case "--help":
    case "-h":
    case undefined:
      output.usage(USAGE);
      break;
    default:
      output.error(`Unknown command: ${command}`);
      output.usage(USAGE);
      process.exitCode = 1;
  }
} catch (error) {
  output.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
