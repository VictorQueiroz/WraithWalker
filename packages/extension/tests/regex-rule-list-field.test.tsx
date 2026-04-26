// @vitest-environment jsdom

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import {
  RegexRuleListField,
  serializeRegexRules,
  validateRegexRule
} from "../src/ui/regex-rule-list-field.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderControlledRegexField({
  initialValue = ["\\.js$"],
  onChange = vi.fn(),
  onValidityChange = vi.fn()
}: {
  initialValue?: string[];
  onChange?: (rules: string[]) => void;
  onValidityChange?: (isValid: boolean) => void;
} = {}) {
  function Harness() {
    const [rules, setRules] = React.useState(initialValue);

    return (
      <RegexRuleListField
        id="rules"
        label="Dump Allowlist Patterns"
        ruleLabel="Dump Allowlist Pattern"
        value={rules}
        placeholder="\\.m?(js|ts)x?$"
        onChange={(nextRules) => {
          setRules(nextRules);
          onChange(nextRules);
        }}
        onValidityChange={onValidityChange}
      />
    );
  }

  render(<Harness />);

  return {
    onChange,
    onValidityChange
  };
}

describe("RegexRuleListField", () => {
  it("renders an empty input row when no rules are configured", () => {
    renderControlledRegexField({
      initialValue: []
    });

    expect(
      (screen.getByLabelText("Dump Allowlist Pattern 1") as HTMLInputElement)
        .value
    ).toBe("");
  });

  it("renders one input row for each rule", () => {
    renderControlledRegexField({
      initialValue: ["\\.js$", "\\.css$"]
    });

    expect(screen.getByText("Dump Allowlist Patterns")).toBeTruthy();
    expect(
      (screen.getByLabelText("Dump Allowlist Pattern 1") as HTMLInputElement)
        .value
    ).toBe("\\.js$");
    expect(
      (screen.getByLabelText("Dump Allowlist Pattern 2") as HTMLInputElement)
        .value
    ).toBe("\\.css$");
  });

  it("adds and removes rule rows while serializing non-empty values", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderControlledRegexField({ onChange });

    await user.click(screen.getByRole("button", { name: "Add Rule" }));
    fireEvent.change(screen.getByLabelText("Dump Allowlist Pattern 2"), {
      target: { value: "\\.json$" }
    });

    expect(onChange).toHaveBeenLastCalledWith(["\\.js$", "\\.json$"]);

    await user.click(screen.getByRole("button", { name: "Remove rule 1" }));

    expect(onChange).toHaveBeenLastCalledWith(["\\.json$"]);
    expect(
      (screen.getByLabelText("Dump Allowlist Pattern 1") as HTMLInputElement)
        .value
    ).toBe("\\.json$");
  });

  it("keeps one empty row after removing the last configured rule", () => {
    const onChange = vi.fn();
    renderControlledRegexField({ onChange });

    fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }));

    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(
      (screen.getByLabelText("Dump Allowlist Pattern 1") as HTMLInputElement)
        .value
    ).toBe("");
  });

  it("reports invalid regular expressions inline", () => {
    const onValidityChange = vi.fn();
    renderControlledRegexField({ onValidityChange });

    fireEvent.change(screen.getByLabelText("Dump Allowlist Pattern 1"), {
      target: { value: "[" }
    });

    expect(screen.getByText(/Invalid regular expression/i)).toBeTruthy();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("serializes trimmed rules and ignores empty rows", () => {
    expect(serializeRegexRules(["  \\.ts$  ", "", "   "])).toEqual(["\\.ts$"]);
    expect(validateRegexRule("\\.js$")).toEqual({
      ok: true,
      error: null
    });
    expect(validateRegexRule("[")).toEqual({
      ok: false,
      error: expect.stringMatching(/Invalid regular expression/i)
    });
  });

  it("uses keyboard shortcuts to add and remove rows without changing existing rules", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderControlledRegexField({
      initialValue: ["\\.js$", "\\.css$"],
      onChange
    });

    await user.click(screen.getByLabelText("Dump Allowlist Pattern 1"));
    await user.keyboard("{Enter}");

    expect(screen.getByLabelText("Dump Allowlist Pattern 2")).toBeTruthy();
    expect(
      (screen.getByLabelText("Dump Allowlist Pattern 1") as HTMLInputElement)
        .value
    ).toBe("\\.js$");
    expect(
      (screen.getByLabelText("Dump Allowlist Pattern 3") as HTMLInputElement)
        .value
    ).toBe("\\.css$");

    await user.keyboard("{Backspace}");

    expect(onChange).toHaveBeenLastCalledWith(["\\.js$", "\\.css$"]);
    expect(screen.queryByLabelText("Dump Allowlist Pattern 3")).toBeNull();
  });

  it("syncs rows when the parent replaces the rule list", () => {
    function Harness() {
      const [rules, setRules] = React.useState(["\\.js$"]);

      return (
        <>
          <RegexRuleListField
            id="rules"
            label="Patterns"
            value={rules}
            onChange={setRules}
          />
          <button type="button" onClick={() => setRules(["\\.json$"])}>
            Reset Rules
          </button>
        </>
      );
    }

    render(<Harness />);

    expect(
      (screen.getByLabelText("Patterns 1") as HTMLInputElement).value
    ).toBe("\\.js$");

    fireEvent.click(screen.getByRole("button", { name: "Reset Rules" }));

    expect(
      (screen.getByLabelText("Patterns 1") as HTMLInputElement).value
    ).toBe("\\.json$");
  });

  it("disables row editing and actions when disabled", () => {
    render(
      <RegexRuleListField
        id="rules"
        label="Patterns"
        value={["\\.js$"]}
        disabled
        onChange={vi.fn()}
      />
    );

    expect(
      (screen.getByLabelText("Patterns 1") as HTMLInputElement).disabled
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Remove rule 1"
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Add Rule" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
});
