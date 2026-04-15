import {
  getEditorLaunchOverride,
  updateEditorLaunchOverride
} from "../lib/editor-launch.js";
import type { NativeHostConfig } from "../lib/types.js";

export function getSwitchDialogTargetName<
  TSwitchDialog extends { targetName: string }
>(switchDialog: TSwitchDialog | null): string | null {
  return switchDialog ? switchDialog.targetName : null;
}

export function withSwitchDialogTargetName<
  TSwitchDialog extends { targetName: string },
  TResult
>(
  switchDialog: TSwitchDialog | null,
  callback: (targetName: string) => TResult
): TResult | undefined {
  const switchTargetName = getSwitchDialogTargetName(switchDialog);
  return switchTargetName ? callback(switchTargetName) : undefined;
}

export function withUpdatedEditorUrlOverride(
  current: NativeHostConfig | null,
  editorId: string,
  urlTemplate: string
): NativeHostConfig | null {
  return current
    ? updateEditorLaunchOverride(current, editorId, {
        ...getEditorLaunchOverride(current, editorId),
        urlTemplate
      })
    : current;
}

export function withUpdatedEditorCommandOverride(
  current: NativeHostConfig | null,
  editorId: string,
  commandTemplate: string
): NativeHostConfig | null {
  return current
    ? updateEditorLaunchOverride(current, editorId, {
        ...getEditorLaunchOverride(current, editorId),
        commandTemplate
      })
    : current;
}
