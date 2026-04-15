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
