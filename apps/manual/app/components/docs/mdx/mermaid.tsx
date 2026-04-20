"use client";

import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { useTheme } from "next-themes";

interface MermaidProps {
  chart: string;
}

export function Mermaid({ chart }: MermaidProps) {
  const { theme, resolvedTheme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const id = React.useId().replace(/:/g, "");

  useEffect(() => {
    const isDark = (resolvedTheme || theme) === "dark";

    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? "dark" : "default",
      securityLevel: "loose",
      fontFamily: "inherit",
      themeVariables: {
        primaryColor: isDark ? "#22d3ee" : "#0891b2",
        primaryTextColor: isDark ? "#f8fafc" : "#0f172a",
        lineColor: isDark ? "#334155" : "#cbd5e1"
      }
    });

    const render = async () => {
      try {
        const { svg } = await mermaid.render(id, chart);
        setSvg(svg);
      } catch (error) {
        console.error("Mermaid render failure:", error);
      }
    };

    render();
  }, [chart, id, theme, resolvedTheme]);

  return (
    <div
      ref={ref}
      className="flex justify-center my-8 p-4 bg-muted/30 rounded-xl border border-border/50 overflow-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
