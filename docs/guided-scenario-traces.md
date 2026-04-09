# Guided Scenario Traces

Guided scenario traces let an MCP-connected agent ask a user to click through specific parts of an app, then store those clicks alongside the captured fixtures inside the active WraithWalker root.

This feature is server-backed in v1:

- `wraithwalker serve` must be running
- the extension must be connected to that local server
- the browser session must be active

## What It Is For

Use guided traces when the user can point at the exact part of the UI they mean more easily than they can describe it.

Typical flow:

1. Ask `trace-status`.
2. Wait until the phase is `idle`.
3. Call `start-trace`, optionally with a `name` and `goal`.
4. Ask the user to click the parts of the app they are talking about.
5. Poll `trace-status` while the trace is active.
6. Call `stop-trace`.
7. Call `read-trace` only when you need the full stored record.

That gives the agent:

- the click selector
- the page URL
- a small text snippet from the clicked element
- linked captured fixtures written right after that click
- a small summary of recent steps, linked fixture counts, and trace progress without forcing a full raw trace read

## MCP Tools

The local MCP server exposes:

- `browser-status`
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

Simple-mode storage still works the same way:

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

The extension injects a small page-side click collector through the debugger transport, not through a general MV3 content-script messaging architecture.

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

- [Extension and Cursor workflow](./extension-workflow.md)
- [MCP clients](./mcp-clients.md)
- [MCP server README](../packages/mcp-server/README.md)
