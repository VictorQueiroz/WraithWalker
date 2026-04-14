import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const extensionPath = path.join(repoRoot, "packages/extension/dist");

describe("extension browser smoke", () => {
  it("loads the built extension, registers its service worker, and renders popup/options shells without startup errors", async () => {
    const userDataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "wraithwalker-extension-smoke-")
    );
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    try {
      let serviceWorker = context.serviceWorkers()[0];
      if (!serviceWorker) {
        serviceWorker = await context.waitForEvent("serviceworker");
      }

      const workerErrors: string[] = [];
      serviceWorker.on("console", (message) => {
        if (message.type() === "error") {
          workerErrors.push(message.text());
        }
      });

      const extensionId = new URL(serviceWorker.url()).host;
      expect(extensionId).toBeTruthy();

      const popupPage = await context.newPage();
      const popupConsoleErrors: string[] = [];
      const popupPageErrors: string[] = [];
      popupPage.on("console", (message) => {
        if (message.type() === "error") {
          popupConsoleErrors.push(message.text());
        }
      });
      popupPage.on("pageerror", (error) => {
        popupPageErrors.push(error.message);
      });
      await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
      await popupPage.waitForSelector("text=WraithWalker");

      const optionsPage = await context.newPage();
      const optionsConsoleErrors: string[] = [];
      const optionsPageErrors: string[] = [];
      optionsPage.on("console", (message) => {
        if (message.type() === "error") {
          optionsConsoleErrors.push(message.text());
        }
      });
      optionsPage.on("pageerror", (error) => {
        optionsPageErrors.push(error.message);
      });
      await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
      await optionsPage.waitForSelector("text=WraithWalker");
      await optionsPage.waitForTimeout(250);

      expect(workerErrors).toEqual([]);
      expect(popupConsoleErrors).toEqual([]);
      expect(popupPageErrors).toEqual([]);
      expect(optionsConsoleErrors).toEqual([]);
      expect(optionsPageErrors).toEqual([]);
    } finally {
      await context.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  });
});
