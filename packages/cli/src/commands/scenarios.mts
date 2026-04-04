import { listScenarios } from "@wraithwalker/mcp-server/fixture-reader";
import { diffScenarios, renderDiffMarkdown } from "@wraithwalker/mcp-server/fixture-diff";
import { saveScenario, switchScenario, readSentinel } from "@wraithwalker/native-host/lib";
import { findRoot } from "../lib/root.mjs";

export async function run(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "list":
      return listCommand();
    case "save":
      return saveCommand(rest[0]);
    case "switch":
      return switchCommand(rest[0]);
    case "diff":
      return diffCommand(rest[0], rest[1]);
    default:
      console.error(`Usage: wraithwalker scenarios {list|save|switch|diff}`);
      process.exitCode = 1;
  }
}

async function listCommand(): Promise<void> {
  const { rootPath } = await findRoot();
  const scenarios = await listScenarios(rootPath);

  if (scenarios.length === 0) {
    console.log("No scenarios saved.");
    return;
  }

  for (const name of scenarios) {
    console.log(name);
  }
}

async function saveCommand(name?: string): Promise<void> {
  if (!name) {
    console.error("Usage: wraithwalker scenarios save <name>");
    process.exitCode = 1;
    return;
  }

  const { rootPath, sentinel } = await findRoot();
  await saveScenario({ path: rootPath, expectedRootId: sentinel.rootId, name });
  console.log(`Scenario "${name}" saved.`);
}

async function switchCommand(name?: string): Promise<void> {
  if (!name) {
    console.error("Usage: wraithwalker scenarios switch <name>");
    process.exitCode = 1;
    return;
  }

  const { rootPath, sentinel } = await findRoot();
  await switchScenario({ path: rootPath, expectedRootId: sentinel.rootId, name });
  console.log(`Switched to "${name}".`);
}

async function diffCommand(a?: string, b?: string): Promise<void> {
  if (!a || !b) {
    console.error("Usage: wraithwalker scenarios diff <scenarioA> <scenarioB>");
    process.exitCode = 1;
    return;
  }

  const { rootPath } = await findRoot();
  const diff = await diffScenarios(rootPath, a, b);
  console.log(renderDiffMarkdown(diff));
}
