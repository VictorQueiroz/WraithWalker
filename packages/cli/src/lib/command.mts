import type { Output } from "./output.mjs";
import type { ResolvedCliConfig } from "./theme.mjs";

export interface CommandContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
  output: Output;
  cliConfig: ResolvedCliConfig;
}

export interface CommandSpec<TArgs, TResult> {
  name: string;
  summary: string;
  usage: string;
  requiresRoot?: boolean;
  parse(argv: string[]): TArgs;
  execute(context: CommandContext, args: TArgs): Promise<TResult>;
  render(output: Output, result: TResult): void;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}
