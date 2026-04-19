import { source } from "@/lib/docs-source";
import { DocsSidebar } from "../components/docs/docs-sidebar";
import { DocsHeader } from "../components/docs/docs-header";
import { siteConfig } from "@/lib/theme-config";

export default function DocsLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const tree = source.pageTree;

  return (
    <div className="min-h-screen flex flex-col">
      <DocsHeader tree={tree} />
      <div className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          <div className="flex gap-8 xl:gap-10">
            <DocsSidebar tree={tree} />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </div>
      </div>
      <footer className="border-t border-border/80 py-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 text-sm text-muted-foreground sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <p>{siteConfig.footer.copyright}</p>
          <div className="flex flex-wrap items-center gap-4">
            {siteConfig.footer.links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="hover:text-foreground transition-colors"
              >
                {link.label}
              </a>
            ))}
            <span className="text-muted-foreground/40">|</span>
            <a
              href="/llms.txt"
              className="font-mono text-xs hover:text-foreground transition-colors"
            >
              llms.txt
            </a>
            <a
              href="/llms-full.txt"
              className="font-mono text-xs hover:text-foreground transition-colors"
            >
              llms-full.txt
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
