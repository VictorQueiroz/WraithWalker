import type { RuntimeApi } from "./chrome-api.js";

export interface WorkspaceStatusChangedMessage {
  type: "workspace.statusChanged";
}

export function createWorkspaceStatusChangedMessage(): WorkspaceStatusChangedMessage {
  return { type: "workspace.statusChanged" };
}

export function isWorkspaceStatusChangedMessage(
  message: unknown
): message is WorkspaceStatusChangedMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    (message as { type?: unknown }).type === "workspace.statusChanged"
  );
}

export function subscribeToWorkspaceStatusChanges(
  runtime: Partial<Pick<RuntimeApi, "onMessage">>,
  onStatusChanged: () => void
): () => void {
  if (!runtime.onMessage) {
    return () => undefined;
  }

  const listener: Parameters<typeof runtime.onMessage.addListener>[0] = (
    message
  ) => {
    if (isWorkspaceStatusChangedMessage(message)) {
      onStatusChanged();
    }

    return undefined;
  };

  runtime.onMessage.addListener(listener);

  return () => {
    runtime.onMessage?.removeListener?.(listener);
  };
}
