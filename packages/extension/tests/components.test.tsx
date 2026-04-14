// @vitest-environment jsdom

import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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
  Separator,
  Textarea
} from "../src/ui/components.js";

afterEach(() => {
  cleanup();
});

describe("ui component primitives", () => {
  it("renders status and action primitives with their expected variants", () => {
    render(
      <div>
        <Button variant="destructive">Delete fixture</Button>
        <Alert variant="success">Capture ready.</Alert>
        <Badge variant="muted">Muted badge</Badge>
      </div>
    );

    expect(
      screen.getByRole("button", { name: "Delete fixture" }).className
    ).toContain("bg-destructive");
    expect(screen.getByText("Capture ready.").className).toContain(
      "border-emerald-500/20"
    );
    expect(screen.getByText("Muted badge").className).toContain("bg-muted");
  });

  it("renders card and form primitives with stable structural classes", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Fixture settings</CardTitle>
        </CardHeader>
        <CardContent>
          <Label htmlFor="origin">Origin</Label>
          <Input id="origin" defaultValue="https://app.example.com" />
          <Textarea aria-label="Patterns" defaultValue={"\\.js$"} />
          <Separator role="separator" />
        </CardContent>
      </Card>
    );

    expect(
      screen.getByText("Fixture settings").closest("section")?.className
    ).toContain("rounded-2xl");
    expect(screen.getByLabelText("Origin").className).toContain("rounded-xl");
    expect(screen.getByLabelText("Patterns").className).toContain("min-h-24");
    expect(screen.getByText("Fixture settings").className).toContain(
      "tracking-tight"
    );
    expect(screen.getByRole("separator").className).toContain("h-px");
  });
});
