import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyExtensionVersionToManifest,
  createBuildPaths,
  createDistRuntimeCopies,
  createStaticExtensionCopies,
  rewriteIdbSpecifiers
} from "../scripts/build-lib.ts";

describe("build layout helpers", () => {
  it("derives the canonical build paths from the package root", () => {
    const paths = createBuildPaths(process.cwd());

    expect(paths.emitDir).toBe(path.join(process.cwd(), ".ts-emit"));
    expect(paths.packageJsonFile).toBe(
      path.join(process.cwd(), "package.json")
    );
    expect(paths.staticDir).toBe(path.join(process.cwd(), "static"));
    expect(paths.staticManifestFile).toBe(
      path.join(process.cwd(), "static", "manifest.json")
    );
    expect(paths.distDir).toBe(path.join(process.cwd(), "dist"));
    expect(paths.distManifestFile).toBe(
      path.join(process.cwd(), "dist", "manifest.json")
    );
    expect(paths.libEmitDir).toBe(path.join(process.cwd(), ".ts-emit", "lib"));
    expect(paths.distVendorFile).toBe(
      path.join(process.cwd(), "dist", "vendor", "idb.js")
    );
    expect(paths.vendorSource).toMatch(/idb[/\\]build[/\\]index\.js$/);
    expect(paths.uiStylesSource).toBe(
      path.join(process.cwd(), "src", "ui", "styles.css")
    );
    expect(paths.distCssFile).toBe(path.join(process.cwd(), "dist", "app.css"));
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
        sourcePath: path.join(process.cwd(), "static", "assets", "logo.svg"),
        targetPath: path.join(process.cwd(), "dist", "assets", "logo.svg")
      },
      {
        sourcePath: path.join(
          process.cwd(),
          "static",
          "assets",
          "icons",
          "icon-16.png"
        ),
        targetPath: path.join(
          process.cwd(),
          "dist",
          "assets",
          "icons",
          "icon-16.png"
        )
      },
      {
        sourcePath: path.join(
          process.cwd(),
          "static",
          "assets",
          "icons",
          "icon-32.png"
        ),
        targetPath: path.join(
          process.cwd(),
          "dist",
          "assets",
          "icons",
          "icon-32.png"
        )
      },
      {
        sourcePath: path.join(
          process.cwd(),
          "static",
          "assets",
          "icons",
          "icon-48.png"
        ),
        targetPath: path.join(
          process.cwd(),
          "dist",
          "assets",
          "icons",
          "icon-48.png"
        )
      },
      {
        sourcePath: path.join(
          process.cwd(),
          "static",
          "assets",
          "icons",
          "icon-128.png"
        ),
        targetPath: path.join(
          process.cwd(),
          "dist",
          "assets",
          "icons",
          "icon-128.png"
        )
      }
    ]);
  });
});

describe("applyExtensionVersionToManifest", () => {
  it("overrides the manifest version with the extension package version", () => {
    expect(
      applyExtensionVersionToManifest(
        {
          manifest_version: 3,
          name: "WraithWalker",
          version: "0.0.0"
        },
        {
          version: "2.4.1"
        }
      )
    ).toEqual({
      manifest_version: 3,
      name: "WraithWalker",
      version: "2.4.1"
    });
  });
});

describe("rewriteIdbSpecifiers", () => {
  it("rewrites a bare double-quoted idb import to the vendor path", () => {
    const input = 'import { openDB } from "idb";';
    expect(rewriteIdbSpecifiers(input)).toBe(
      'import { openDB } from "../vendor/idb.js";'
    );
  });

  it("rewrites a bare single-quoted idb import to the vendor path", () => {
    const input = "import { openDB } from 'idb';";
    expect(rewriteIdbSpecifiers(input)).toBe(
      'import { openDB } from "../vendor/idb.js";'
    );
  });

  it("rewrites multiple idb imports in the same source", () => {
    const input = [
      'import { openDB } from "idb";',
      'import type { DBSchema } from "idb";'
    ].join("\n");
    const result = rewriteIdbSpecifiers(input);
    expect(result).not.toContain('from "idb"');
    expect(result).toContain('from "../vendor/idb.js"');
    expect(result.match(/from "\.\.\/vendor\/idb\.js"/g)).toHaveLength(2);
  });

  it("does not rewrite imports from idb sub-paths or other packages", () => {
    const input = [
      'import { foo } from "idb-keyval";',
      'import { bar } from "./idb.js";',
      'import { baz } from "../vendor/idb.js";'
    ].join("\n");
    expect(rewriteIdbSpecifiers(input)).toBe(input);
  });

  it("leaves source unchanged when there are no idb imports", () => {
    const input = 'import { something } from "./other.js";';
    expect(rewriteIdbSpecifiers(input)).toBe(input);
  });
});

describe("built extension runtime", () => {
  it("does not ship React development runtime markers in popup and options bundles", async () => {
    const popupBundle = await fs.readFile(
      path.join(process.cwd(), "dist", "popup.js"),
      "utf-8"
    );
    const optionsBundle = await fs.readFile(
      path.join(process.cwd(), "dist", "options.js"),
      "utf-8"
    );

    for (const bundle of [popupBundle, optionsBundle]) {
      expect(bundle).not.toContain("react.development.js");
      expect(bundle).not.toContain("jsxDEVImpl");
    }
  });
});
