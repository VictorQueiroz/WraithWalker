import {
  diffScenarios,
  listScenarios,
  renderDiffMarkdown,
  saveScenario,
  switchScenario
} from "@wraithwalker/core/scenarios";
import { findRoot } from "@wraithwalker/core/root";

import type { CommandSpec } from "../lib/command.mjs";
import { UsageError } from "../lib/command.mjs";

type ScenarioArgs =
  | { action: "list" }
  | { action: "save"; name: string }
  | { action: "switch"; name: string }
  | { action: "diff"; scenarioA: string; scenarioB: string };

type ScenarioResult =
  | { action: "list"; scenarios: string[] }
  | { action: "save"; name: string }
  | { action: "switch"; name: string }
  | { action: "diff"; markdown: string };

export const command: CommandSpec<ScenarioArgs, ScenarioResult> = {
  name: "scenarios",
  summary: "Manage scenario snapshots",
  usage: "Usage: wraithwalker scenarios {list|save|switch|diff}",
  requiresRoot: true,
  parse(argv) {
    const [subcommand, ...rest] = argv;

    switch (subcommand) {
      case "list":
        return { action: "list" };
      case "save":
        if (!rest[0]) {
          throw new UsageError("Usage: wraithwalker scenarios save <name>");
        }
        return { action: "save", name: rest[0] };
      case "switch":
        if (!rest[0]) {
          throw new UsageError("Usage: wraithwalker scenarios switch <name>");
        }
        return { action: "switch", name: rest[0] };
      case "diff":
        if (!rest[0] || !rest[1]) {
          throw new UsageError("Usage: wraithwalker scenarios diff <scenarioA> <scenarioB>");
        }
        return { action: "diff", scenarioA: rest[0], scenarioB: rest[1] };
      default:
        throw new UsageError("Usage: wraithwalker scenarios {list|save|switch|diff}");
    }
  },
  async execute(context, args) {
    const { rootPath, sentinel } = await findRoot(context.cwd);

    switch (args.action) {
      case "list":
        return {
          action: "list",
          scenarios: await listScenarios(rootPath)
        };
      case "save": {
        const result = await saveScenario({
          path: rootPath,
          expectedRootId: sentinel.rootId,
          name: args.name
        });
        return {
          action: "save",
          name: result.name
        };
      }
      case "switch": {
        const result = await switchScenario({
          path: rootPath,
          expectedRootId: sentinel.rootId,
          name: args.name
        });
        return {
          action: "switch",
          name: result.name
        };
      }
      case "diff": {
        const diff = await diffScenarios(rootPath, args.scenarioA, args.scenarioB);
        return {
          action: "diff",
          markdown: renderDiffMarkdown(diff)
        };
      }
    }
  },
  render(output, result) {
    switch (result.action) {
      case "list":
        if (result.scenarios.length === 0) {
          output.info("No scenarios saved.");
          return;
        }
        for (const scenario of result.scenarios) {
          output.listItem(scenario);
        }
        return;
      case "save":
        output.success(`Scenario "${result.name}" saved.`);
        return;
      case "switch":
        output.success(`Switched to "${result.name}".`);
        return;
      case "diff":
        output.block(result.markdown);
    }
  }
};
