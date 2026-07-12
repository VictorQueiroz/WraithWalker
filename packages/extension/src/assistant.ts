import * as React from "react";
import { createRoot } from "react-dom/client";

import type { AssistantClient } from "./lib/assistant-client.js";
import {
  AssistantApp,
  type AssistantTransportFactory
} from "./ui/assistant-app.js";

export interface AssistantDependencies {
  document?: Document;
  client?: AssistantClient;
  transportFactory?: AssistantTransportFactory;
  generateConversationId?: () => string;
}

function isTestMode(): boolean {
  return Boolean(
    (globalThis as typeof globalThis & { __WRAITHWALKER_TEST__?: boolean })
      .__WRAITHWALKER_TEST__
  );
}

export function initAssistant({
  document: documentRef = document,
  client,
  transportFactory,
  generateConversationId
}: AssistantDependencies = {}) {
  const container = documentRef.getElementById("root");
  if (!container) {
    throw new Error("Assistant root container not found.");
  }

  const root = createRoot(container);
  root.render(
    React.createElement(AssistantApp, {
      ...(client ? { client } : {}),
      ...(transportFactory ? { transportFactory } : {}),
      ...(generateConversationId ? { generateConversationId } : {})
    })
  );

  return {
    root,
    unmount() {
      root.unmount();
    }
  };
}

if (!isTestMode()) {
  void initAssistant();
}
