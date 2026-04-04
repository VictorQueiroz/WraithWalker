import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { findRoot } from "../lib/root.mjs";

export async function run(_args: string[]): Promise<void> {
  const { rootPath } = await findRoot();
  const require = createRequire(import.meta.url);
  const mcpServerPkg = require.resolve("@wraithwalker/mcp-server/fixture-reader");
  const serverPath = mcpServerPkg.replace(/fixture-reader\.mjs$/, "server.mjs");

  const child = spawn(process.execPath, [serverPath, rootPath], {
    stdio: "inherit"
  });

  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}
