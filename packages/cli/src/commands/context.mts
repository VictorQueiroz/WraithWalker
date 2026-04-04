import { findRoot } from "../lib/root.mjs";
import { createFsGateway } from "../lib/fs-gateway.mjs";
import { generateContext } from "../lib/context-generator.mjs";

export async function run(args: string[]): Promise<void> {
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
  console.log(`Context generated at ${rootPath}`);
  if (editorId) {
    console.log(`Editor: ${editorId}`);
  }
}
