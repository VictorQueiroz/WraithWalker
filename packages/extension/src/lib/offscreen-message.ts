import type { OffscreenMessage } from "./messages.js";

const KNOWN_OFFSCREEN_MESSAGE_TYPES = new Set<OffscreenMessage["type"]>([
  "fs.ensureRoot",
  "fs.readConfiguredSiteConfigs",
  "fs.readEffectiveSiteConfigs",
  "fs.writeConfiguredSiteConfigs",
  "fs.hasFixture",
  "fs.readFixture",
  "fs.writeFixture",
  "fs.generateContext"
]);

type OffscreenTargetCandidate = {
  target: "offscreen";
  type?: unknown;
  payload?: unknown;
};

export type OffscreenMessageClassification =
  | { kind: "ignore" }
  | { kind: "unknown"; type: unknown }
  | { kind: "known"; message: OffscreenMessage };

export function classifyOffscreenMessage(
  message: unknown
): OffscreenMessageClassification {
  if (!message || typeof message !== "object") {
    return { kind: "ignore" };
  }

  const typedMessage = message as { target?: unknown; type?: unknown };
  if (typedMessage.target !== "offscreen") {
    return { kind: "ignore" };
  }

  if (
    !KNOWN_OFFSCREEN_MESSAGE_TYPES.has(
      typedMessage.type as OffscreenMessage["type"]
    )
  ) {
    return {
      kind: "unknown",
      type: typedMessage.type
    };
  }

  return {
    kind: "known",
    message: message as OffscreenTargetCandidate as OffscreenMessage
  };
}
