# @wraithwalker/cli

## 2.1.2

### Patch Changes

- 1cb5eb8: Enforce a shared site-config uniqueness invariant across config reads and writes.

  Normalized duplicate origins now collapse to one canonical site config while preserving the earliest `createdAt`, merging `dumpAllowlistPatterns` with stable deduping, and keeping config-facing CLI and MCP flows on the same deduped shape.

- Updated dependencies [1cb5eb8]
  - @wraithwalker/core@2.2.1
  - @wraithwalker/mcp-server@2.3.1

## 2.1.1

### Patch Changes

- Updated dependencies [95a8088]
  - @wraithwalker/core@2.2.0
  - @wraithwalker/mcp-server@2.3.0

## 2.1.0

### Minor Changes

- 8eed8bd: Add projection workspace MCP tools for same-machine agents so they can check out selected human-facing files, edit them locally, and push tracked changes back safely.

### Patch Changes

- Updated dependencies [8eed8bd]
  - @wraithwalker/mcp-server@2.2.0

## 2.0.2

### Patch Changes

- Updated dependencies [2f7bd97]
  - @wraithwalker/core@2.1.0
  - @wraithwalker/mcp-server@2.1.0
