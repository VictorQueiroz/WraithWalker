import * as React from "react";

import { DEFAULT_DUMP_ALLOWLIST_PATTERNS } from "../lib/constants.js";
import { originToPermissionPattern } from "../lib/path-utils.js";
import type { SiteConfig } from "../lib/types.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea
} from "./components.js";
import { SectionIntro } from "./options-app.shared.js";

function parseDumpAllowlistPatterns(text: string): string[] {
  const patterns = text
    .split(/\r\n|\n|\r/)
    .map((value) => value.trim())
    .filter(Boolean);

  return patterns.length > 0 ? patterns : [...DEFAULT_DUMP_ALLOWLIST_PATTERNS];
}

function formatDumpAllowlistPatterns(patterns: string[]): string {
  return patterns.join("\n");
}

function arePatternListsEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((pattern, index) => pattern === right[index])
  );
}

function formatCreatedDate(createdAt: string): string {
  const [date] = createdAt.split("T");
  return date || createdAt;
}

function SiteCard({
  siteConfig,
  storageLabel,
  disabled = false,
  onDraftingChange,
  onSave,
  onRemove
}: {
  siteConfig: SiteConfig;
  storageLabel: string;
  disabled?: boolean;
  onDraftingChange?: (origin: string, isDrafting: boolean) => void;
  onSave: (
    origin: string,
    patch: Pick<SiteConfig, "dumpAllowlistPatterns">
  ) => Promise<void>;
  onRemove: (origin: string) => Promise<void>;
}) {
  const formattedPatterns = React.useMemo(
    () => formatDumpAllowlistPatterns(siteConfig.dumpAllowlistPatterns),
    [siteConfig.dumpAllowlistPatterns]
  );
  const [patternsText, setPatternsText] = React.useState(formattedPatterns);
  const [busy, setBusy] = React.useState<"save" | "remove" | null>(null);
  const parsedPatterns = React.useMemo(
    () => parseDumpAllowlistPatterns(patternsText),
    [patternsText]
  );
  const isDrafting = !arePatternListsEqual(
    parsedPatterns,
    siteConfig.dumpAllowlistPatterns
  );
  const permissionPattern = originToPermissionPattern(siteConfig.origin);

  React.useEffect(() => {
    if (!isDrafting) {
      setPatternsText(formattedPatterns);
    }
  }, [formattedPatterns, isDrafting]);

  React.useEffect(() => {
    onDraftingChange?.(siteConfig.origin, isDrafting);

    return () => {
      onDraftingChange?.(siteConfig.origin, false);
    };
  }, [isDrafting, onDraftingChange, siteConfig.origin]);

  return (
    <Card className="bg-card/80">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-2">
            <CardTitle>{siteConfig.origin}</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">Configured</Badge>
              <Badge variant={disabled ? "muted" : "default"}>
                {disabled ? "Read only" : "Editable"}
              </Badge>
              <Badge variant="muted">{storageLabel}</Badge>
              {isDrafting ? <Badge>Unsaved changes</Badge> : null}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== null || disabled || !isDrafting}
              onClick={async () => {
                setBusy("save");
                try {
                  await onSave(siteConfig.origin, {
                    dumpAllowlistPatterns: parsedPatterns
                  });
                  setPatternsText(formatDumpAllowlistPatterns(parsedPatterns));
                } finally {
                  setBusy(null);
                }
              }}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy !== null || disabled}
              onClick={async () => {
                setBusy("remove");
                try {
                  await onRemove(siteConfig.origin);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid gap-3 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm sm:grid-cols-3">
          <div className="grid gap-1">
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Permission Pattern
            </dt>
            <dd className="break-all font-mono text-xs">{permissionPattern}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Added
            </dt>
            <dd>{formatCreatedDate(siteConfig.createdAt)}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Stored In
            </dt>
            <dd>{storageLabel}</dd>
          </div>
        </dl>
        <div className="grid gap-2">
          <Label htmlFor={`patterns-${siteConfig.origin}`}>
            Dump Allowlist Patterns
          </Label>
          <Textarea
            id={`patterns-${siteConfig.origin}`}
            value={patternsText}
            disabled={disabled}
            onChange={(event) => setPatternsText(event.currentTarget.value)}
            placeholder={"\\.m?(js|ts)x?$"}
          />
          <p className="text-xs text-muted-foreground">
            One regular expression per line.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function EnabledOriginsSection({
  serverConnected,
  serverRootPath,
  canEditSites,
  siteOriginInput,
  sites,
  originsBlockedMessage,
  onSiteOriginInputChange,
  onAddSite,
  onDraftingChange,
  onSaveSite,
  onRemoveSite
}: {
  serverConnected: boolean;
  serverRootPath?: string;
  canEditSites: boolean;
  siteOriginInput: string;
  sites: SiteConfig[];
  originsBlockedMessage: string;
  onSiteOriginInputChange: (value: string) => void;
  onAddSite: React.FormEventHandler<HTMLFormElement>;
  onDraftingChange?: (origin: string, isDrafting: boolean) => void;
  onSaveSite: (
    origin: string,
    patch: Pick<SiteConfig, "dumpAllowlistPatterns">
  ) => Promise<void>;
  onRemoveSite: (origin: string) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <SectionIntro
          title="Enabled Origins"
          description="Review the exact origins WraithWalker can capture, where the rules are stored, and which file patterns each origin can dump."
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        {serverConnected ? (
          <Alert variant="success">
            Server Root is active.
            {serverRootPath
              ? ` Editing ${serverRootPath}.`
              : " Editing Server Root."}
          </Alert>
        ) : null}
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto]"
          onSubmit={onAddSite}
        >
          <Input
            aria-label="Exact origin"
            placeholder="https://app.example.com"
            disabled={!canEditSites}
            value={siteOriginInput}
            onChange={(event) =>
              onSiteOriginInputChange(event.currentTarget.value)
            }
          />
          <Button type="submit" disabled={!canEditSites}>
            Add Origin
          </Button>
        </form>
        <div className="grid gap-3">
          {!canEditSites ? (
            <Alert variant="default">{originsBlockedMessage}</Alert>
          ) : sites.length > 0 ? (
            sites.map((siteConfig) => (
              <SiteCard
                key={siteConfig.origin}
                siteConfig={siteConfig}
                storageLabel={
                  serverConnected
                    ? "Stored in Server Root"
                    : "Stored in Remembered Browser Root"
                }
                disabled={!canEditSites}
                onDraftingChange={onDraftingChange}
                onSave={onSaveSite}
                onRemove={onRemoveSite}
              />
            ))
          ) : (
            <Alert variant="default">
              Add your first origin above to make capture useful.
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
