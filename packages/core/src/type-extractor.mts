export type TypeNode =
  | { kind: "object"; properties: Record<string, TypeNode> }
  | { kind: "array"; element: TypeNode }
  | { kind: "primitive"; value: "string" | "number" | "boolean" | "null" }
  | { kind: "union"; members: TypeNode[] }
  | { kind: "unknown" };

export function inferTypeNode(value: unknown): TypeNode {
  if (value === null) return { kind: "primitive", value: "null" };
  if (typeof value === "string") return { kind: "primitive", value: "string" };
  if (typeof value === "number") return { kind: "primitive", value: "number" };
  if (typeof value === "boolean")
    return { kind: "primitive", value: "boolean" };

  if (Array.isArray(value)) {
    if (value.length === 0)
      return { kind: "array", element: { kind: "unknown" } };
    const merged = value.map(inferTypeNode).reduce(mergeTypeNodes);
    return { kind: "array", element: merged };
  }

  if (typeof value === "object") {
    const properties: Record<string, TypeNode> = {};
    for (const [key, val] of Object.entries(value)) {
      properties[key] = inferTypeNode(val);
    }
    return { kind: "object", properties };
  }

  return { kind: "unknown" };
}

function typeNodeEquals(a: TypeNode, b: TypeNode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "primitive" && b.kind === "primitive")
    return a.value === b.value;
  if (a.kind === "unknown" && b.kind === "unknown") return true;
  if (a.kind === "array" && b.kind === "array")
    return typeNodeEquals(a.element, b.element);
  if (a.kind === "object" && b.kind === "object") {
    const aKeys = Object.keys(a.properties).sort();
    const bKeys = Object.keys(b.properties).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key, index) =>
        key === bKeys[index] &&
        typeNodeEquals(a.properties[key], b.properties[key])
    );
  }
  return false;
}

function flattenUnion(node: TypeNode): TypeNode[] {
  if (node.kind === "union") return node.members.flatMap(flattenUnion);
  return [node];
}

function deduplicateMembers(members: TypeNode[]): TypeNode[] {
  const result: TypeNode[] = [];
  for (const member of members) {
    if (!result.some((existing) => typeNodeEquals(existing, member))) {
      result.push(member);
    }
  }
  return result;
}

export function mergeTypeNodes(a: TypeNode, b: TypeNode): TypeNode {
  if (typeNodeEquals(a, b)) return a;
  if (a.kind === "unknown") return b;
  if (b.kind === "unknown") return a;

  if (a.kind === "object" && b.kind === "object") {
    const allKeys = new Set([
      ...Object.keys(a.properties),
      ...Object.keys(b.properties)
    ]);
    const properties: Record<string, TypeNode> = {};
    for (const key of allKeys) {
      const left = a.properties[key];
      const right = b.properties[key];
      properties[key] =
        left && right
          ? mergeTypeNodes(left, right)
          : ((left || right) as TypeNode);
    }
    return { kind: "object", properties };
  }

  if (a.kind === "array" && b.kind === "array") {
    return { kind: "array", element: mergeTypeNodes(a.element, b.element) };
  }

  const members = deduplicateMembers([...flattenUnion(a), ...flattenUnion(b)]);
  if (members.length === 1) return members[0];
  return { kind: "union", members };
}

export function renderTypeNode(node: TypeNode, indent = 0): string {
  const pad = "  ".repeat(indent);

  switch (node.kind) {
    case "primitive":
      return node.value;
    case "unknown":
      return "unknown";
    case "array": {
      const inner = renderTypeNode(node.element, indent);
      return node.element.kind === "union" ? `(${inner})[]` : `${inner}[]`;
    }
    case "union":
      return node.members
        .map((member) => renderTypeNode(member, indent))
        .join(" | ");
    case "object": {
      const entries = Object.entries(node.properties);
      if (entries.length === 0) return "{}";
      const innerPad = "  ".repeat(indent + 1);
      const lines = entries.map(
        ([key, value]) =>
          `${innerPad}${key}: ${renderTypeNode(value, indent + 1)};`
      );
      return `{\n${lines.join("\n")}\n${pad}}`;
    }
  }
}

export function pathToInterfaceName(method: string, pathname: string): string {
  const segments = pathname
    .replace(/^\//, "")
    .split(/[/\-_.]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1));

  const prefix = method.charAt(0).toUpperCase() + method.slice(1).toLowerCase();
  return `${prefix}${segments.length > 0 ? segments.join("") : "Root"}Response`;
}

export function renderInterfaceDeclaration(
  name: string,
  node: TypeNode
): string {
  if (node.kind === "object") {
    const entries = Object.entries(node.properties);
    if (entries.length === 0) return `export interface ${name} {}\n`;
    const lines = entries.map(
      ([key, value]) => `  ${key}: ${renderTypeNode(value, 1)};`
    );
    return `export interface ${name} {\n${lines.join("\n")}\n}\n`;
  }

  return `export type ${name} = ${renderTypeNode(node)};\n`;
}

export function renderDtsFile(
  declarations: Array<{ name: string; node: TypeNode }>
): string {
  const lines = [
    "// Auto-generated by WraithWalker from captured API responses.",
    "// Do not edit manually — regenerate from the CLI or extension.",
    ""
  ];

  for (const declaration of declarations) {
    lines.push(renderInterfaceDeclaration(declaration.name, declaration.node));
  }

  return lines.join("\n");
}

export function renderBarrelFile(moduleNames: string[]): string {
  const lines = ["// Auto-generated by WraithWalker.", ""];

  for (const moduleName of moduleNames.sort()) {
    lines.push(`export * from "./${moduleName}";`);
  }

  lines.push("");
  return lines.join("\n");
}
