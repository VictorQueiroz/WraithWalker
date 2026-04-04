import { listScenarios } from "@wraithwalker/mcp-server/fixture-reader";
import { diffScenarios, renderDiffMarkdown } from "@wraithwalker/mcp-server/fixture-diff";
import { saveScenario, switchScenario, readSentinel } from "@wraithwalker/native-host/lib";
import { findRoot } from "../lib/root.mjs";
import type { Output } from "../lib/output.mjs";

export async function run(args: string[], output: Output): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "list":
      return listCommand(output);
    case "save":
      return saveCommand(output, rest[0]);
    case "switch":
      return switchCommand(output, rest[0]);
    case "diff":
      return diffCommand(output, rest[0], rest[1]);
    default:
      output.usage(`Usage: wraithwalker scenarios {list|save|switch|diff}`);
      process.exitCode = 1;
  }
}

async function listCommand(output: Output): Promise<void> {
  const { rootPath } = await findRoot();
  const scenarios = await listScenarios(rootPath);

  if (scenarios.length === 0) {
    output.info("No scenarios saved.");
    return;
  }

  for (const name of scenarios) {
    output.listItem(name);
  }
}

async function saveCommand(output: Output, name?: string): Promise<void> {
  if (!name) {
    output.usage("Usage: wraithwalker scenarios save <name>");
    process.exitCode = 1;
    return;
  }

  const { rootPath, sentinel } = await findRoot();
  await saveScenario({ path: rootPath, expectedRootId: sentinel.rootId, name });
  output.success(`Scenario "${name}" saved.`);
}

async function switchCommand(output: Output, name?: string): Promise<void> {
  if (!name) {
    output.usage("Usage: wraithwalker scenarios switch <name>");
    process.exitCode = 1;
    return;
  }

  const { rootPath, sentinel } = await findRoot();
  await switchScenario({ path: rootPath, expectedRootId: sentinel.rootId, name });
  output.success(`Switched to "${name}".`);
}

async function diffCommand(output: Output, a?: string, b?: string): Promise<void> {
  if (!a || !b) {
    output.usage("Usage: wraithwalker scenarios diff <scenarioA> <scenarioB>");
    process.exitCode = 1;
    return;
  }

  const { rootPath } = await findRoot();
  const diff = await diffScenarios(rootPath, a, b);
  output.block(renderDiffMarkdown(diff));
}
