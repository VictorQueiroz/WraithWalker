import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

export async function startExternalHttpServer(rootPath: string) {
  const candidatePaths = [
    path.resolve(process.cwd(), "packages/mcp-server/src/server.mts"),
    path.resolve(process.cwd(), "../mcp-server/src/server.mts")
  ];
  const serverModulePath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
  if (!serverModulePath) {
    throw new Error(`Unable to locate mcp-server entrypoint from ${process.cwd()}.`);
  }

  const serverModuleUrl = pathToFileURL(serverModulePath).href;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "-e",
      `
        const { startHttpServer } = await import(${JSON.stringify(serverModuleUrl)});
        const server = await startHttpServer(${JSON.stringify(rootPath)}, { host: "127.0.0.1", port: 0 });
        console.log(JSON.stringify({ trpcUrl: server.trpcUrl, rootPath: server.rootPath }));
        const shutdown = async () => {
          try {
            await server.close();
          } finally {
            process.exit(0);
          }
        };
        process.on("SIGTERM", shutdown);
        process.on("SIGINT", shutdown);
        setInterval(() => {}, 1 << 30);
      `
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const started = await new Promise<{ trpcUrl: string; rootPath: string }>((resolve, reject) => {
    const onExit = (code: number | null) => {
      reject(new Error(`External test server exited before startup (${code ?? "signal"}): ${stderr || stdout}`));
    };

    child.once("exit", onExit);
    const poll = () => {
      const lineBreakIndex = stdout.indexOf("\n");
      if (lineBreakIndex === -1) {
        setTimeout(poll, 10);
        return;
      }

      child.off("exit", onExit);
      try {
        resolve(JSON.parse(stdout.slice(0, lineBreakIndex)));
      } catch (error) {
        reject(error);
      }
    };

    poll();
  });

  return {
    ...started,
    async close() {
      if (child.exitCode !== null || child.killed) {
        return;
      }

      child.kill("SIGTERM");
      await once(child, "exit");
    }
  };
}
