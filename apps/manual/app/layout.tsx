import type { Metadata } from "next";
import { ThemeProvider } from "./providers/theme-provider";
import { getSiteUrl, siteConfig } from "@/lib/theme-config";
import "./globals.css";

export function generateMetadata(): Metadata {
  const siteUrl = getSiteUrl();

  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: siteConfig.name,
      template: `%s | ${siteConfig.name}`
    },
    description: siteConfig.description,
    openGraph: {
      title: siteConfig.name,
      description: siteConfig.description,
      url: siteUrl,
      siteName: siteConfig.name,
      images: [
        {
          url: "/assets/wraithwalker-banner.png",
          width: 1280,
          height: 720,
          alt: "WraithWalker banner"
        }
      ]
    },
    twitter: {
      card: "summary_large_image",
      title: siteConfig.name,
      description: siteConfig.description,
      images: ["/assets/wraithwalker-banner.png"]
    }
  };
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
