type SiteConfig = {
  name: string;
  description: string;
  url: string;
  logo: {
    src: string;
    alt: string;
    width: number;
    height: number;
  };
  links: {
    github?: string;
    discord?: string;
    support?: string;
  };
  footer: {
    copyright: string;
    links: Array<{
      label: string;
      href: string;
    }>;
  };
};

export const siteConfig: SiteConfig = {
  name: "WraithWalker",
  description:
    "Capture running websites into local fixture workspaces and expose them over MCP when agent workflows need more context.",
  url: "http://localhost:3000",
  logo: {
    src: "/logo.svg",
    alt: "WraithWalker",
    width: 36,
    height: 36
  },
  links: {
    github: "https://github.com/VictorQueiroz/WraithWalker"
  },
  footer: {
    copyright: "© 2026 WraithWalker contributors.",
    links: [
      { label: "Home", href: "/" },
      { label: "Manual", href: "/docs" },
      { label: "GitHub", href: "https://github.com/VictorQueiroz/WraithWalker" }
    ]
  }
};

export const themeConfig = {
  colors: {
    light: {
      accent: "#0ea5e9",
      accentForeground: "#e6fbff",
      accentMuted: "rgba(14, 165, 233, 0.12)"
    },
    dark: {
      accent: "#6ee7ff",
      accentForeground: "#04111f",
      accentMuted: "rgba(110, 231, 255, 0.14)"
    }
  },
  codeBlock: {
    light: {
      background: "#eef8ff",
      titleBar: "#d9edf7"
    },
    dark: {
      background: "#09111d",
      titleBar: "#0d1829"
    }
  },
  ogImage: {
    gradient: "linear-gradient(135deg, #07111f 0%, #0a1628 42%, #0b2a3d 100%)",
    titleColor: "#f2fdff",
    sectionColor: "#82ecff",
    logoUrl: "http://localhost:3000/logo.svg"
  }
};

export function getCSSVariables(mode: "light" | "dark") {
  const colors = themeConfig.colors[mode];
  return {
    "--accent": colors.accent,
    "--accent-foreground": colors.accentForeground,
    "--accent-muted": colors.accentMuted
  };
}

export function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return siteConfig.url;
}
