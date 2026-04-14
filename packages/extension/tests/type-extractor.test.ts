import { describe, expect, it } from "vitest";

import {
  inferTypeNode,
  mergeTypeNodes,
  renderTypeNode,
  renderInterfaceDeclaration,
  renderDtsFile,
  renderBarrelFile,
  pathToInterfaceName,
  type TypeNode
} from "../src/lib/type-extractor.js";

describe("inferTypeNode", () => {
  it("infers primitives", () => {
    expect(inferTypeNode("hello")).toEqual({
      kind: "primitive",
      value: "string"
    });
    expect(inferTypeNode(42)).toEqual({ kind: "primitive", value: "number" });
    expect(inferTypeNode(true)).toEqual({
      kind: "primitive",
      value: "boolean"
    });
    expect(inferTypeNode(null)).toEqual({ kind: "primitive", value: "null" });
  });

  it("infers empty array as unknown[]", () => {
    expect(inferTypeNode([])).toEqual({
      kind: "array",
      element: { kind: "unknown" }
    });
  });

  it("infers array of homogeneous primitives", () => {
    expect(inferTypeNode([1, 2, 3])).toEqual({
      kind: "array",
      element: { kind: "primitive", value: "number" }
    });
  });

  it("infers array of mixed primitives as union", () => {
    const result = inferTypeNode([1, "two", true]);
    expect(result.kind).toBe("array");
    if (result.kind === "array") {
      expect(result.element.kind).toBe("union");
      if (result.element.kind === "union") {
        expect(result.element.members).toHaveLength(3);
      }
    }
  });

  it("infers nested objects", () => {
    const result = inferTypeNode({ name: "Alice", age: 30 });
    expect(result).toEqual({
      kind: "object",
      properties: {
        name: { kind: "primitive", value: "string" },
        age: { kind: "primitive", value: "number" }
      }
    });
  });

  it("infers array of objects by merging element shapes", () => {
    const result = inferTypeNode([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" }
    ]);
    expect(result).toEqual({
      kind: "array",
      element: {
        kind: "object",
        properties: {
          id: { kind: "primitive", value: "number" },
          name: { kind: "primitive", value: "string" }
        }
      }
    });
  });

  it("returns unknown for undefined-like values", () => {
    expect(inferTypeNode(undefined)).toEqual({ kind: "unknown" });
  });
});

describe("mergeTypeNodes", () => {
  it("returns identical node when both are the same", () => {
    const node: TypeNode = { kind: "primitive", value: "string" };
    expect(mergeTypeNodes(node, node)).toEqual(node);
  });

  it("absorbs unknown into the other node", () => {
    const str: TypeNode = { kind: "primitive", value: "string" };
    expect(mergeTypeNodes({ kind: "unknown" }, str)).toEqual(str);
    expect(mergeTypeNodes(str, { kind: "unknown" })).toEqual(str);
  });

  it("creates a union of different primitives", () => {
    const result = mergeTypeNodes(
      { kind: "primitive", value: "string" },
      { kind: "primitive", value: "number" }
    );
    expect(result).toEqual({
      kind: "union",
      members: [
        { kind: "primitive", value: "string" },
        { kind: "primitive", value: "number" }
      ]
    });
  });

  it("merges two objects with overlapping keys", () => {
    const a: TypeNode = {
      kind: "object",
      properties: {
        id: { kind: "primitive", value: "number" },
        name: { kind: "primitive", value: "string" }
      }
    };
    const b: TypeNode = {
      kind: "object",
      properties: {
        id: { kind: "primitive", value: "number" },
        email: { kind: "primitive", value: "string" }
      }
    };
    const result = mergeTypeNodes(a, b);
    expect(result).toEqual({
      kind: "object",
      properties: {
        id: { kind: "primitive", value: "number" },
        name: { kind: "primitive", value: "string" },
        email: { kind: "primitive", value: "string" }
      }
    });
  });

  it("merges two arrays by merging their element types", () => {
    const a: TypeNode = {
      kind: "array",
      element: { kind: "primitive", value: "string" }
    };
    const b: TypeNode = {
      kind: "array",
      element: { kind: "primitive", value: "number" }
    };
    const result = mergeTypeNodes(a, b);
    expect(result).toEqual({
      kind: "array",
      element: {
        kind: "union",
        members: [
          { kind: "primitive", value: "string" },
          { kind: "primitive", value: "number" }
        ]
      }
    });
  });

  it("flattens nested unions", () => {
    const a: TypeNode = { kind: "primitive", value: "string" };
    const b: TypeNode = { kind: "primitive", value: "number" };
    const c: TypeNode = { kind: "primitive", value: "boolean" };
    const ab = mergeTypeNodes(a, b);
    const abc = mergeTypeNodes(ab, c);
    expect(abc).toEqual({
      kind: "union",
      members: [
        { kind: "primitive", value: "string" },
        { kind: "primitive", value: "number" },
        { kind: "primitive", value: "boolean" }
      ]
    });
  });

  it("deduplicates union members", () => {
    const a: TypeNode = {
      kind: "union",
      members: [
        { kind: "primitive", value: "string" },
        { kind: "primitive", value: "number" }
      ]
    };
    const b: TypeNode = { kind: "primitive", value: "string" };
    const result = mergeTypeNodes(a, b);
    expect(result).toEqual({
      kind: "union",
      members: [
        { kind: "primitive", value: "string" },
        { kind: "primitive", value: "number" }
      ]
    });
  });
});

describe("renderTypeNode", () => {
  it("renders primitives", () => {
    expect(renderTypeNode({ kind: "primitive", value: "string" })).toBe(
      "string"
    );
    expect(renderTypeNode({ kind: "primitive", value: "null" })).toBe("null");
  });

  it("renders unknown", () => {
    expect(renderTypeNode({ kind: "unknown" })).toBe("unknown");
  });

  it("renders simple arrays", () => {
    expect(
      renderTypeNode({
        kind: "array",
        element: { kind: "primitive", value: "number" }
      })
    ).toBe("number[]");
  });

  it("renders union arrays with parens", () => {
    const node: TypeNode = {
      kind: "array",
      element: {
        kind: "union",
        members: [
          { kind: "primitive", value: "string" },
          { kind: "primitive", value: "number" }
        ]
      }
    };
    expect(renderTypeNode(node)).toBe("(string | number)[]");
  });

  it("renders objects with indentation", () => {
    const node: TypeNode = {
      kind: "object",
      properties: {
        id: { kind: "primitive", value: "number" },
        name: { kind: "primitive", value: "string" }
      }
    };
    const result = renderTypeNode(node);
    expect(result).toContain("  id: number;");
    expect(result).toContain("  name: string;");
    expect(result).toMatch(/^\{/);
    expect(result).toMatch(/\}$/);
  });

  it("renders empty objects", () => {
    expect(renderTypeNode({ kind: "object", properties: {} })).toBe("{}");
  });

  it("renders unions", () => {
    const node: TypeNode = {
      kind: "union",
      members: [
        { kind: "primitive", value: "string" },
        { kind: "primitive", value: "null" }
      ]
    };
    expect(renderTypeNode(node)).toBe("string | null");
  });
});

describe("pathToInterfaceName", () => {
  it("converts method and path to PascalCase interface name", () => {
    expect(pathToInterfaceName("GET", "/api/users")).toBe(
      "GetApiUsersResponse"
    );
    expect(pathToInterfaceName("POST", "/graphql")).toBe("PostGraphqlResponse");
    expect(pathToInterfaceName("DELETE", "/api/users/123")).toBe(
      "DeleteApiUsers123Response"
    );
  });

  it("handles root path", () => {
    expect(pathToInterfaceName("GET", "/")).toBe("GetRootResponse");
  });

  it("handles hyphenated and underscored paths", () => {
    expect(pathToInterfaceName("GET", "/api/user-profiles")).toBe(
      "GetApiUserProfilesResponse"
    );
    expect(pathToInterfaceName("GET", "/api/user_settings")).toBe(
      "GetApiUserSettingsResponse"
    );
  });
});

describe("renderInterfaceDeclaration", () => {
  it("renders an object as an interface", () => {
    const node: TypeNode = {
      kind: "object",
      properties: {
        id: { kind: "primitive", value: "number" },
        name: { kind: "primitive", value: "string" }
      }
    };
    const result = renderInterfaceDeclaration("GetUsersResponse", node);
    expect(result).toContain("export interface GetUsersResponse {");
    expect(result).toContain("  id: number;");
    expect(result).toContain("  name: string;");
    expect(result).toContain("}");
  });

  it("renders non-object types as type aliases", () => {
    const node: TypeNode = {
      kind: "array",
      element: { kind: "primitive", value: "string" }
    };
    const result = renderInterfaceDeclaration("GetTagsResponse", node);
    expect(result).toBe("export type GetTagsResponse = string[];\n");
  });

  it("renders empty object interface", () => {
    const result = renderInterfaceDeclaration("EmptyResponse", {
      kind: "object",
      properties: {}
    });
    expect(result).toBe("export interface EmptyResponse {}\n");
  });
});

describe("renderDtsFile", () => {
  it("renders a complete .d.ts file with header and declarations", () => {
    const result = renderDtsFile([
      {
        name: "GetUsersResponse",
        node: {
          kind: "object",
          properties: { id: { kind: "primitive", value: "number" } }
        }
      }
    ]);
    expect(result).toContain("// Auto-generated by WraithWalker");
    expect(result).toContain("export interface GetUsersResponse");
  });
});

describe("renderBarrelFile", () => {
  it("renders sorted re-exports", () => {
    const result = renderBarrelFile(["users", "auth"]);
    expect(result).toContain('export * from "./auth";');
    expect(result).toContain('export * from "./users";');
    expect(result.indexOf("auth")).toBeLessThan(result.indexOf("users"));
  });
});
