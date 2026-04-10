# Guided Scenario Traces

Guided scenario traces let an MCP-connected agent ask a user to click through a running app, then store those clicks alongside the captured fixtures inside the active WraithWalker root.

## Requirements

Guided traces currently require all of the following:

- `wraithwalker serve` is running
- the browser extension is connected to that local server
- the browser session is active
- at least one origin is enabled for capture

If any of those are missing, `trace-status` explains what is blocking the flow.

## When To Use It

Use guided traces when the user can point at the exact UI they mean more easily than they can describe it.

Examples:

- “This dropdown opens from here”
- “This modal appears after I click this button”
- “This page breaks after this sequence of clicks”

The trace gives the agent:

- the click selector
- the page URL
- a short text snippet from the clicked element
- linked captured fixtures written right after that click
- a compact progress summary without forcing a full raw trace read

## Recommended MCP Flow

1. Call `trace-status`.
2. Wait until the phase is `idle`.
3. Call `start-trace`, optionally with a `name` and `goal`.
4. Ask the user to click the relevant parts of the app.
5. Poll `trace-status` while the trace is active.
6. Call `stop-trace` with the returned `traceId`.
7. Call `read-trace` only when you need the full stored record.

For most agents, `trace-status` should stay the main progress surface. Save `read-trace` for the moments when the compact summary is not enough.

## MCP Tools

The local MCP server exposes:

- `browser-status`
- `read-console`
- `trace-status`
- `start-trace`
- `stop-trace`
- `list-traces`
- `read-trace`

### `browser-status`

This is the readiness gate.

Important fields:

- `connected`
- `captureReady`
- `sessionActive`
- `captureDestination`
- `enabledOrigins`
- `activeTrace`
- `tracePhase`
- `blockingReason`
- `activeTraceSummary`

`captureReady` means:

- the extension heartbeat is live
- the extension session is active
- capture is using the server root
- at least one origin is enabled

### `read-console`

This returns the recent console and log entries that the connected extension observed through the Chrome Debugger session.

Useful filters:

- `limit`
- `tabId`
- `search`
- `sources`
- `levels`

### `trace-status`

This is the agent-first guided trace surface.

Important fields:

- `phase`
- `blockingReason`
- `connected`
- `captureReady`
- `sessionActive`
- `captureDestination`
- `enabledOrigins`
- `activeTrace`
- `guidance`

`phase` is one of:

- `disconnected`
- `not_ready`
- `idle`
- `armed`
- `recording`

`activeTrace` is a compact agent summary, not the full stored trace. It includes:

- the trace id, name, and optional goal
- the current status
- total step and linked-fixture counts
- the most recent click metadata
- up to 5 recent steps

## What Gets Stored

Guided traces live under:

- `.wraithwalker/scenario-traces/active.json`
- `.wraithwalker/scenario-traces/<traceId>/trace.json`

`trace.json` stores:

- trace identity and lifecycle state
- optional trace goal
- selected origins
- extension client id
- recorded click steps
- linked fixtures for each step

Simple-mode fixture storage still works the same way:

- captured asset bodies stay visible at the root
- metadata and manifests stay under `.wraithwalker`
- guided trace state also stays under `.wraithwalker`

## How Fixture Linking Works

Each click step is linked to fixtures using the captured request start time.

A fixture is linked to the most recent click when:

- it was captured from the same tab
- the request started after the click
- it happened before the next click on that tab
- it happened within 5 seconds of that click

This keeps traces small and useful without copying raw bodies into the trace file.

## Chrome Debugger API Path

This flow is debugger-first.

WraithWalker uses the existing Chrome Debugger session and adds DevTools Protocol support for:

- `Runtime.addBinding`
- `Page.addScriptToEvaluateOnNewDocument`
- `Runtime.evaluate`
- `Runtime.bindingCalled`

The extension injects a small page-side click collector through the debugger transport, not through a general MV3 content-script messaging layer.

That collector computes a selector in the page, sends a sanitized payload back through the debugger binding, and the background worker forwards that to the local tRPC server.

## Step By Step

1. Start the server:

   ```bash
   wraithwalker serve
   ```

2. Start the extension session and browse normally.
3. In your MCP client, call `trace-status`.
4. When the phase is `idle`, call `start-trace`.
5. Ask the user to click through the relevant UI.
6. Poll `trace-status` while the trace is running.
7. Call `stop-trace`.
8. Inspect the stored result with `read-trace` only if the compact summaries are not enough.

## Related Docs

- [Extension workflow](./extension-workflow.md)
- [MCP client setup](./mcp-clients.md)
- [MCP server README](../packages/mcp-server/README.md)
