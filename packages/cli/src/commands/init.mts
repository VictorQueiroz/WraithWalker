import path from "node:path";
import { createRoot } from "../lib/root.mjs";
import type { Output } from "../lib/output.mjs";

export async function run(args: string[], output: Output): Promise<void> {
  const dir = path.resolve(args[0] || process.cwd());
  const sentinel = await createRoot(dir);
  output.banner();
  output.success(`Fixture root ready at ${dir}`);
  output.keyValue("Root ID", sentinel.rootId);
}
