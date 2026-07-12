export const ASSISTANT_PAGE_PATH = "assistant.html";

export interface AssistantLaunchChrome {
  runtime: { getURL(path: string): string };
  tabs: { create(properties: { url: string }): Promise<unknown> };
}

export interface AssistantLauncher {
  openAssistant(): Promise<void>;
}

export function createAssistantLauncher(
  chromeRef: AssistantLaunchChrome = chrome as unknown as AssistantLaunchChrome
): AssistantLauncher {
  return {
    async openAssistant() {
      await chromeRef.tabs.create({
        url: chromeRef.runtime.getURL(ASSISTANT_PAGE_PATH)
      });
    }
  };
}
