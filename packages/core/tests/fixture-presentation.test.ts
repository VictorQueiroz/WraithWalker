import { describe, expect, it } from "vitest";

import {
  createProjectedFixturePayload,
  decodeFixtureBodyText,
  inferPrettyFilepath,
  prettifyFixtureText
} from "../src/fixture-presentation.mts";

describe("fixture presentation", () => {
  it("prettifies JavaScript fixtures and keeps supported script extensions", async () => {
    expect(inferPrettyFilepath({
      relativePath: "cdn.example.com/assets/chunk.js",
      text: "function renderMenu(){return{open:true}}"
    })).toBe("cdn.example.com/assets/chunk.js");

    await expect(prettifyFixtureText({
      relativePath: "cdn.example.com/assets/chunk.js",
      text: "function renderMenu(){return{open:true}}"
    })).resolves.toBe(
      "function renderMenu() {\n  return { open: true };\n}"
    );
  });

  it("uses mime metadata to pick JSON, CSS, JavaScript, and TypeScript formatters", () => {
    expect(inferPrettyFilepath({
      relativePath: "payload.txt",
      text: "{\"users\":[{\"id\":1}]}",
      mimeType: "application/json; charset=utf-8"
    })).toBe("payload.json");

    expect(inferPrettyFilepath({
      relativePath: "styles/theme.body",
      text: ".menu{color:red}",
      mimeType: "text/css"
    })).toBe("styles/theme.css");

    expect(inferPrettyFilepath({
      relativePath: "scripts/runtime.body",
      text: "const value=1",
      mimeType: "application/ecmascript"
    })).toBe("scripts/runtime.js");

    expect(inferPrettyFilepath({
      relativePath: "types/runtime.body",
      text: "type User={id:number}",
      mimeType: "application/typescript"
    })).toBe("types/runtime.ts");
  });

  it("uses resource types and path extensions when metadata is partial", () => {
    expect(inferPrettyFilepath({
      relativePath: "views/page.txt",
      text: "<main><section><p>Hello</p></section></main>",
      resourceType: "Document"
    })).toBe("views/page.html");

    expect(inferPrettyFilepath({
      relativePath: "styles/dropdown.txt",
      text: ".dropdown{color:#111}",
      resourceType: "Stylesheet"
    })).toBe("styles/dropdown.css");

    expect(inferPrettyFilepath({
      relativePath: "scripts/app.txt",
      text: "const ready=true",
      resourceType: "Script"
    })).toBe("scripts/app.js");

    expect(inferPrettyFilepath({
      relativePath: "components/widget.tsx",
      text: "export const Widget=()=>null",
      resourceType: "Other"
    })).toBe("components/widget.tsx");
  });

  it("falls back to lightweight JSON and HTML heuristics when metadata is absent", async () => {
    expect(inferPrettyFilepath({
      relativePath: "captures/menu-response",
      text: "{\"ok\":true}"
    })).toBe("captures/menu-response.json");

    expect(inferPrettyFilepath({
      relativePath: "captures/menu-markup",
      text: "<div><span>Menu</span></div>"
    })).toBe("captures/menu-markup.html");

    expect(inferPrettyFilepath({
      relativePath: "captures/broken-response",
      text: "{\"ok\":"
    })).toBeNull();

    expect(inferPrettyFilepath({
      relativePath: "captures/empty",
      text: "   "
    })).toBeNull();

    await expect(prettifyFixtureText({
      relativePath: "captures/menu-response",
      text: "{\"ok\":true}"
    })).resolves.toBe('{ "ok": true }');
  });

  it("prettifies HTML and CSS bodies through metadata-driven inference", async () => {
    await expect(prettifyFixtureText({
      relativePath: "views/page.body",
      text: "<main><section><h1>Title</h1><p>Hello</p></section></main>",
      mimeType: "text/html"
    })).resolves.toBe(
      "<main>\n  <section>\n    <h1>Title</h1>\n    <p>Hello</p>\n  </section>\n</main>"
    );

    await expect(prettifyFixtureText({
      relativePath: "styles/dropdown.body",
      text: ".dropdown{color:#111;background:#fff}",
      mimeType: "text/css"
    })).resolves.toBe(
      ".dropdown {\n  color: #111;\n  background: #fff;\n}"
    );
  });

  it("returns raw text for unsupported or invalid content", async () => {
    expect(inferPrettyFilepath({
      relativePath: "notes/ui-guidelines.txt",
      text: "dropdown guidance",
      mimeType: "text/plain"
    })).toBeNull();

    const plainText = "dropdown guidance";
    await expect(prettifyFixtureText({
      relativePath: "notes/ui-guidelines",
      text: plainText,
      resourceType: "Other"
    })).resolves.toBe(plainText);

    const invalidScript = "function {";
    await expect(prettifyFixtureText({
      relativePath: "cdn.example.com/assets/broken.js",
      text: invalidScript
    })).resolves.toBe(invalidScript);
  });

  it("decodes fixture body payloads across utf8, atob, and buffer fallbacks", async () => {
    expect(decodeFixtureBodyText({
      body: "plain text",
      bodyEncoding: "utf8"
    })).toBe("plain text");

    const originalAtob = globalThis.atob;
    const originalBuffer = globalThis.Buffer;
    const capturedInputs: string[] = [];

    try {
      globalThis.atob = ((value: string) => {
        capturedInputs.push(value);
        return "{\"ok\":true}";
      }) as typeof atob;

      expect(decodeFixtureBodyText({
        body: "ignored-base64",
        bodyEncoding: "base64"
      })).toBe("{\"ok\":true}");
      expect(capturedInputs).toEqual(["ignored-base64"]);

      // Force the non-atob fallback branch.
      // @ts-ignore test override
      globalThis.atob = undefined;
      // @ts-ignore test override
      globalThis.Buffer = Buffer;

      expect(decodeFixtureBodyText({
        body: Buffer.from("{\"buffer\":true}", "utf8").toString("base64"),
        bodyEncoding: "base64"
      })).toBe("{\"buffer\":true}");
    } finally {
      globalThis.atob = originalAtob;
      // @ts-ignore restoring test override
      globalThis.Buffer = originalBuffer;
    }
  });

  it("falls back to the raw payload when projected fixture bytes are not valid utf8", async () => {
    const binaryPayload = Buffer.from([0xff, 0xfe, 0xfd, 0x00]).toString("base64");

    expect(decodeFixtureBodyText({
      body: binaryPayload,
      bodyEncoding: "base64"
    })).toBeNull();

    await expect(createProjectedFixturePayload({
      relativePath: "cdn.example.com/assets/app.wasm",
      payload: {
        body: binaryPayload,
        bodyEncoding: "base64"
      },
      mimeType: "application/wasm",
      resourceType: "Other"
    })).resolves.toEqual({
      body: binaryPayload,
      bodyEncoding: "base64"
    });
  });
});
