import { describe, expect, it, vi } from "vitest";

import {
  createWorkspaceStatusChangedMessage,
  isWorkspaceStatusChangedMessage,
  subscribeToWorkspaceStatusChanges
} from "../src/lib/workspace-status-events.ts";

function createRuntimeOnMessage() {
  const listeners: Array<(message: unknown) => unknown> = [];

  return {
    addListener: vi.fn((listener: (message: unknown) => unknown) => {
      listeners.push(listener);
    }),
    removeListener: vi.fn((listener: (message: unknown) => unknown) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    }),
    emit(message: unknown) {
      for (const listener of [...listeners]) {
        listener(message);
      }
    }
  };
}

describe("workspace status events", () => {
  it("creates and recognizes workspace status changed messages", () => {
    const message = createWorkspaceStatusChangedMessage();

    expect(message).toEqual({ type: "workspace.statusChanged" });
    expect(isWorkspaceStatusChangedMessage(message)).toBe(true);
    expect(isWorkspaceStatusChangedMessage({ type: "other" })).toBe(false);
    expect(isWorkspaceStatusChangedMessage(null)).toBe(false);
    expect(isWorkspaceStatusChangedMessage("workspace.statusChanged")).toBe(
      false
    );
  });

  it("subscribes to matching runtime messages and unsubscribes cleanly", () => {
    const onMessage = createRuntimeOnMessage();
    const onStatusChanged = vi.fn();

    const unsubscribe = subscribeToWorkspaceStatusChanges(
      { onMessage },
      onStatusChanged
    );

    expect(onMessage.addListener).toHaveBeenCalledTimes(1);

    onMessage.emit({ type: "other" });
    onMessage.emit(createWorkspaceStatusChangedMessage());

    expect(onStatusChanged).toHaveBeenCalledTimes(1);

    unsubscribe();

    expect(onMessage.removeListener).toHaveBeenCalledTimes(1);

    onMessage.emit(createWorkspaceStatusChangedMessage());

    expect(onStatusChanged).toHaveBeenCalledTimes(1);
  });

  it("returns a no-op unsubscribe when runtime.onMessage is unavailable", () => {
    const unsubscribe = subscribeToWorkspaceStatusChanges({}, vi.fn());

    expect(unsubscribe).toBeTypeOf("function");
    expect(() => unsubscribe()).not.toThrow();
  });
});
