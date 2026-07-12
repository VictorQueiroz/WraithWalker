import { describe, expect, it, vi } from "vitest";

import {
  ASSISTANT_PAGE_PATH,
  createAssistantLauncher
} from "../src/lib/assistant-launch.js";

describe("createAssistantLauncher", () => {
  it("opens the assistant page in a new tab", async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const launcher = createAssistantLauncher({
      runtime: {
        getURL: (path) => `chrome-extension://abc/${path}`
      },
      tabs: { create }
    });

    await launcher.openAssistant();

    expect(create).toHaveBeenCalledWith({
      url: `chrome-extension://abc/${ASSISTANT_PAGE_PATH}`
    });
  });
});
