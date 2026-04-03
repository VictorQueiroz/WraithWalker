import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createBuildPaths,
  createDistRuntimeCopies,
  createNativeHostCopies,
  createStaticExtensionCopies
} from "../scripts/build-lib.ts";

describe("build layout helpers", () => {
  it("derives the canonical build paths from the repository root", () => {
    const paths = createBuildPaths("/repo");

    expect(paths.emitDir).toBe(path.join("/repo", ".ts-emit"));
    expect(paths.extensionDir).toBe(path.join("/repo", "extension"));
    expect(paths.distDir).toBe(path.join("/repo", "dist"));
    expect(paths.libEmitDir).toBe(path.join("/repo", ".ts-emit", "lib"));
    expect(paths.distVendorFile).toBe(path.join("/repo", "dist", "vendor", "idb.js"));
  });

  it("assembles dist runtime copies directly from emit output rather than root artifacts", () => {
    const paths = createBuildPaths("/repo");
    const copies = createDistRuntimeCopies(paths);

    expect(copies).toEqual([
      {
        sourcePath: path.join("/repo", ".ts-emit", "background.js"),
        targetPath: path.join("/repo", "dist", "background.js")
      },
      {
        sourcePath: path.join("/repo", ".ts-emit", "popup.js"),
        targetPath: path.join("/repo", "dist", "popup.js")
      },
      {
        sourcePath: path.join("/repo", ".ts-emit", "options.js"),
        targetPath: path.join("/repo", "dist", "options.js")
      },
      {
        sourcePath: path.join("/repo", ".ts-emit", "offscreen.js"),
        targetPath: path.join("/repo", "dist", "offscreen.js")
      }
    ]);
  });

  it("keeps static extension and native-host copies in their expected locations", () => {
    const paths = createBuildPaths("/repo");

    expect(createStaticExtensionCopies(paths)).toEqual([
      {
        sourcePath: path.join("/repo", "extension", "manifest.json"),
        targetPath: path.join("/repo", "dist", "manifest.json")
      },
      {
        sourcePath: path.join("/repo", "extension", "popup.html"),
        targetPath: path.join("/repo", "dist", "popup.html")
      },
      {
        sourcePath: path.join("/repo", "extension", "options.html"),
        targetPath: path.join("/repo", "dist", "options.html")
      },
      {
        sourcePath: path.join("/repo", "extension", "offscreen.html"),
        targetPath: path.join("/repo", "dist", "offscreen.html")
      },
      {
        sourcePath: path.join("/repo", "extension", "app.css"),
        targetPath: path.join("/repo", "dist", "app.css")
      },
      {
        sourcePath: path.join("/repo", "extension", "assets", "logo.svg"),
        targetPath: path.join("/repo", "dist", "assets", "logo.svg")
      },
      {
        sourcePath: path.join("/repo", "extension", "assets", "icons", "icon-16.png"),
        targetPath: path.join("/repo", "dist", "assets", "icons", "icon-16.png")
      },
      {
        sourcePath: path.join("/repo", "extension", "assets", "icons", "icon-32.png"),
        targetPath: path.join("/repo", "dist", "assets", "icons", "icon-32.png")
      },
      {
        sourcePath: path.join("/repo", "extension", "assets", "icons", "icon-48.png"),
        targetPath: path.join("/repo", "dist", "assets", "icons", "icon-48.png")
      },
      {
        sourcePath: path.join("/repo", "extension", "assets", "icons", "icon-128.png"),
        targetPath: path.join("/repo", "dist", "assets", "icons", "icon-128.png")
      }
    ]);

    expect(createNativeHostCopies(paths)).toEqual([
      {
        sourcePath: path.join("/repo", ".ts-emit", "native-host", "host.mjs"),
        targetPath: path.join("/repo", "native-host", "host.mjs")
      },
      {
        sourcePath: path.join("/repo", ".ts-emit", "native-host", "lib.mjs"),
        targetPath: path.join("/repo", "native-host", "lib.mjs")
      }
    ]);
  });
});
