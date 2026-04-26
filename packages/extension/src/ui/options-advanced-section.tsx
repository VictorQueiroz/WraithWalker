import type { Dispatch, SetStateAction } from "react";

import type { EditorPreset } from "../lib/constants.js";
import type { EditorLaunchOverride, NativeHostConfig } from "../lib/types.js";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator
} from "./components.js";
import {
  withUpdatedEditorCommandOverride,
  withUpdatedEditorUrlOverride
} from "./options-app.helpers.js";

export function AdvancedNativeHostSection({
  advancedOpen,
  nativeHostConfig,
  cursorEditor,
  cursorOverride,
  setAdvancedOpen,
  setNativeHostConfigState,
  onSaveLaunchSettings,
  onVerifyHelper
}: {
  advancedOpen: boolean;
  nativeHostConfig: NativeHostConfig | null;
  cursorEditor: EditorPreset;
  cursorOverride: EditorLaunchOverride;
  setAdvancedOpen: Dispatch<SetStateAction<boolean>>;
  setNativeHostConfigState: Dispatch<SetStateAction<NativeHostConfig | null>>;
  onSaveLaunchSettings: () => void | Promise<void>;
  onVerifyHelper: () => void | Promise<void>;
}) {
  return (
    <Card className="opacity-90">
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Advanced Native Host</CardTitle>
            <CardDescription>
              Collapsed by default so the main flow stays focused on the active
              root and default editor.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            {advancedOpen ? "Hide" : "Show"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!advancedOpen ? (
          <Alert variant="default">
            Hidden by default so the common flow stays simple. Open this section
            when you need native-host verification or editor overrides.
          </Alert>
        ) : null}

        {advancedOpen && nativeHostConfig ? (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="native-host-name">Native Host Name</Label>
              <Input
                id="native-host-name"
                value={nativeHostConfig.hostName}
                onChange={(event) => {
                  const hostName = event.currentTarget.value;
                  setNativeHostConfigState((current) =>
                    current ? { ...current, hostName } : current
                  );
                }}
                placeholder="com.wraithwalker.host"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="native-root-path">
                Shared Editor Launch Path
              </Label>
              <Input
                id="native-root-path"
                value={nativeHostConfig.launchPath}
                onChange={(event) => {
                  const launchPath = event.currentTarget.value;
                  setNativeHostConfigState((current) =>
                    current ? { ...current, launchPath } : current
                  );
                }}
                placeholder="/Users/you/wraithwalker-fixtures"
              />
              <p className="text-xs text-muted-foreground">
                Needed when you want Cursor to open Remembered Browser Root
                directly, or when using the native host fallback. Without it,
                Cursor can still launch and receive the workspace brief through
                its prompt deeplink, but Chrome does not expose the absolute
                local path back to the extension.
              </p>
            </div>
            <Separator />
            <div className="grid gap-2">
              <Label htmlFor="editor-url-template">
                Custom URL Override For Cursor
              </Label>
              <Input
                id="editor-url-template"
                value={cursorOverride.urlTemplate ?? ""}
                onChange={(event) => {
                  const urlTemplate = event.currentTarget.value;
                  setNativeHostConfigState((current) =>
                    withUpdatedEditorUrlOverride(
                      current,
                      cursorEditor.id,
                      urlTemplate
                    )
                  );
                }}
                placeholder={
                  cursorEditor.urlTemplate ||
                  "custom://open?folder=$DIR_COMPONENT"
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="editor-command-template">
                Custom Command Override For Cursor
              </Label>
              <Input
                id="editor-command-template"
                value={cursorOverride.commandTemplate ?? ""}
                onChange={(event) => {
                  const commandTemplate = event.currentTarget.value;
                  setNativeHostConfigState((current) =>
                    withUpdatedEditorCommandOverride(
                      current,
                      cursorEditor.id,
                      commandTemplate
                    )
                  );
                }}
                placeholder={cursorEditor.commandTemplate}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={() => void onSaveLaunchSettings()}>
                Save Launch Settings
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void onVerifyHelper()}
              >
                Verify Helper
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
