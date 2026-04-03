import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createBuildPaths,
  createDistRuntimeCopies,
  createStaticExtensionCopies
} from "../scripts/build-lib.ts";

describe("build layout helpers", () => {
  it("derives the canonical build paths from the package root", () => {
    const paths = createBuildPaths(process.cwd());

    expect(paths.emitDir).toBe(path.join(process.cwd(), ".ts-emit"));
    expect(paths.staticDir).toBe(path.join(process.cwd(), "static"));
    expect(paths.distDir).toBe(path.join(process.cwd(), "dist"));
    expect(paths.libEmitDir).toBe(path.join(process.cwd(), ".ts-emit", "lib"));
    expect(paths.distVendorFile).toBe(path.join(process.cwd(), "dist", "vendor", "idb.js"));
    expect(paths.vendorSource).toMatch(/idb[/\\]build[/\\]index\.js$/);
  });

  it("assembles dist runtime copies directly from emit output rather than root artifacts", () => {
    const paths = createBuildPaths(process.cwd());
    const copies = createDistRuntimeCopies(paths);

    expect(copies).toEqual([
      {
        sourcePath: path.join(process.cwd(), ".ts-emit", "background.js"),
        targetPath: path.join(process.cwd(), "dist", "background.js")
      },
      {
        sourcePath: path.join(process.cwd(), ".ts-emit", "popup.js"),
        targetPath: path.join(process.cwd(), "dist", "popup.js")
      },
      {
        sourcePath: path.join(process.cwd(), ".ts-emit", "options.js"),
        targetPath: path.join(process.cwd(), "dist", "options.js")
      },
      {
        sourcePath: path.join(process.cwd(), ".ts-emit", "offscreen.js"),
        targetPath: path.join(process.cwd(), "dist", "offscreen.js")
      }
    ]);
  });

  it("keeps static extension copies in their expected locations", () => {
    const paths = createBuildPaths(process.cwd());

    expect(createStaticExtensionCopies(paths)).toEqual([
      {
        sourcePath: path.join(process.cwd(), "static", "manifest.json"),
        targetPath: path.join(process.cwd(), "dist", "manifest.json")
      },
      {
        sourcePath: path.join(process.cwd(), "static", "popup.html"),
        targetPath: path.join(process.cwd(), "dist", "popup.html")
      },
      {
        sourcePath: path.join(process.cwd(), "static", "options.html"),
        targetPath: path.join(process.cwd(), "dist", "options.html")
      },
      {
        sourcePath: path.join(process.cwd(), "static", "offscreen.html"),
        targetPath: path.join(process.cwd(), "dist", "offscreen.html")
      },
      {
        sourcePath: path.join(process.cwd(), "static", "app.css"),
        targetPath: path.join(process.cwd(), "dist", "app.css")
      },
      {
        sourcePath: path.join(process.cwd(), "static", "assets", "logo.svg"),
        targetPath: path.join(process.cwd(), "dist", "assets", "logo.svg")
      },
      {
        sourcePath: path.join(process.cwd(), "static", "assets", "icons", "icon-16.png"),
        targetPath: path.join(process.cwd(), "dist", "assets", "icons", "icon-16.png")
      },
      {
        sourcePath: path.join(process.cwd(), "static", "assets", "icons", "icon-32.png"),
        targetPath: path.join(process.cwd(), "dist", "assets", "icons", "icon-32.png")
      },
      {
        sourcePath: path.join(process.cwd(), "static", "assets", "icons", "icon-48.png"),
        targetPath: path.join(process.cwd(), "dist", "assets", "icons", "icon-48.png")
      },
      {
        sourcePath: path.join(process.cwd(), "static", "assets", "icons", "icon-128.png"),
        targetPath: path.join(process.cwd(), "dist", "assets", "icons", "icon-128.png")
      }
    ]);
  });
});
