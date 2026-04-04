import { findRoot } from "../lib/root.mjs";
import { createFsGateway } from "../lib/fs-gateway.mjs";
import { generateContext } from "../lib/context-generator.mjs";
import type { Output } from "../lib/output.mjs";

export async function run(args: string[], output: Output): Promise<void> {
  let editorId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--editor" && args[i + 1]) {
      editorId = args[i + 1];
      i++;
    }
  }

  const { rootPath } = await findRoot();
  const gateway = createFsGateway();
  await generateContext(rootPath, gateway, editorId);
  output.success(`Context generated at ${rootPath}`);
  if (editorId) {
    output.keyValue("Editor", editorId);
  }
}
