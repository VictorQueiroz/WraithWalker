import path from "node:path";
import { createRoot } from "../lib/root.mjs";

export async function run(args: string[]): Promise<void> {
  const dir = path.resolve(args[0] || process.cwd());
  const sentinel = await createRoot(dir);
  console.log(`Fixture root ready at ${dir}`);
  console.log(`Root ID: ${sentinel.rootId}`);
}
