import * as React from "react";

import { Button, Input, Label } from "./components.js";

interface RegexRuleRow {
  id: string;
  value: string;
}

export interface RegexRuleValidation {
  ok: boolean;
  error: string | null;
}

export interface RegexRuleListFieldProps {
  id: string;
  label: string;
  ruleLabel?: string;
  value: string[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (rules: string[]) => void;
  onValidityChange?: (isValid: boolean) => void;
}

let nextRuleRowId = 0;

function createRuleRow(value: string): RegexRuleRow {
  nextRuleRowId += 1;
  return {
    id: `regex-rule-${nextRuleRowId}`,
    value
  };
}

function createRows(values: readonly string[]): RegexRuleRow[] {
  return values.length > 0
    ? values.map((value) => createRuleRow(value))
    : [createRuleRow("")];
}

export function serializeRegexRules(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function serializeRows(rows: readonly RegexRuleRow[]): string[] {
  return serializeRegexRules(rows.map((row) => row.value));
}

function getRulesKey(values: readonly string[]): string {
  return serializeRegexRules(values).join("\n");
}

export function validateRegexRule(pattern: string): RegexRuleValidation {
  const normalized = pattern.trim();
  if (!normalized) {
    return {
      ok: true,
      error: null
    };
  }

  try {
    void new RegExp(normalized);
    return {
      ok: true,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message
    };
  }
}

export function RegexRuleListField({
  id,
  label,
  ruleLabel = label,
  value,
  disabled = false,
  placeholder,
  onChange,
  onValidityChange
}: RegexRuleListFieldProps) {
  const [rows, setRows] = React.useState<RegexRuleRow[]>(() =>
    createRows(value)
  );
  const [pendingFocusRowId, setPendingFocusRowId] = React.useState<
    string | null
  >(null);
  const inputRefs = React.useRef(new Map<string, HTMLInputElement>());
  const externalRulesKey = getRulesKey(value);
  const currentRulesKey = getRulesKey(rows.map((row) => row.value));
  const validations = rows.map((row) => validateRegexRule(row.value));
  const isValid = validations.every((validation) => validation.ok);

  React.useEffect(() => {
    if (externalRulesKey !== currentRulesKey) {
      setRows(createRows(value));
    }
  }, [currentRulesKey, externalRulesKey, value]);

  React.useEffect(() => {
    onValidityChange?.(isValid);
  }, [isValid, onValidityChange]);

  React.useEffect(() => {
    if (!pendingFocusRowId) {
      return;
    }

    inputRefs.current.get(pendingFocusRowId)?.focus();
    setPendingFocusRowId(null);
  }, [pendingFocusRowId, rows]);

  function commitRows(nextRows: RegexRuleRow[], focusRowId?: string): void {
    const committedRows = nextRows.length > 0 ? nextRows : [createRuleRow("")];
    setRows(committedRows);
    onChange(serializeRows(committedRows));
    if (focusRowId) {
      setPendingFocusRowId(focusRowId);
    }
  }

  function updateRow(rowId: string, nextValue: string): void {
    commitRows(
      rows.map((row) => (row.id === rowId ? { ...row, value: nextValue } : row))
    );
  }

  function addRowAfter(index: number): void {
    const nextRow = createRuleRow("");
    commitRows(
      [...rows.slice(0, index + 1), nextRow, ...rows.slice(index + 1)],
      nextRow.id
    );
  }

  function removeRow(index: number): void {
    const nextRows = rows.filter((_row, rowIndex) => rowIndex !== index);
    const nextFocusRow = nextRows[Math.max(0, index - 1)];
    commitRows(nextRows, nextFocusRow?.id);
  }

  function handleRuleKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    index: number
  ): void {
    if (event.key === "Enter") {
      event.preventDefault();
      addRowAfter(index);
      return;
    }

    if (
      event.key === "Backspace" &&
      rows[index]?.value === "" &&
      rows.length > 1
    ) {
      event.preventDefault();
      removeRow(index);
    }
  }

  return (
    <div className="grid gap-2">
      <Label id={`${id}-label`}>{label}</Label>
      <div aria-labelledby={`${id}-label`} className="grid gap-2" role="group">
        {rows.map((row, index) => {
          const validation = validations[index]!;
          const inputId = `${id}-${row.id}`;
          const errorId = `${inputId}-error`;

          return (
            <div className="grid gap-1" key={row.id}>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid gap-1">
                  <Label className="sr-only" htmlFor={inputId}>
                    {ruleLabel} {index + 1}
                  </Label>
                  <Input
                    ref={(element) => {
                      if (element) {
                        inputRefs.current.set(row.id, element);
                      } else {
                        inputRefs.current.delete(row.id);
                      }
                    }}
                    id={inputId}
                    value={row.value}
                    disabled={disabled}
                    aria-invalid={!validation.ok}
                    aria-describedby={!validation.ok ? errorId : undefined}
                    className="font-mono"
                    spellCheck={false}
                    placeholder={placeholder}
                    onChange={(event) =>
                      updateRow(row.id, event.currentTarget.value)
                    }
                    onKeyDown={(event) => handleRuleKeyDown(event, index)}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={disabled}
                  aria-label={`Remove rule ${index + 1}`}
                  onClick={() => removeRow(index)}
                >
                  Remove
                </Button>
              </div>
              {!validation.ok && validation.error ? (
                <p className="text-xs text-destructive" id={errorId}>
                  {validation.error}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => addRowAfter(rows.length - 1)}
        >
          Add Rule
        </Button>
      </div>
    </div>
  );
}
