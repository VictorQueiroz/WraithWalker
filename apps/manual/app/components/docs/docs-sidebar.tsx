"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Root, Node } from "fumadocs-core/page-tree";

interface DocsSidebarProps {
  tree: Root;
}

export function DocsSidebar({ tree }: DocsSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:block w-72 shrink-0">
      <nav className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto pb-10 pr-4">
        <div className="rounded-2xl border border-border/70 bg-card/60 p-4 backdrop-blur-md">
          <SidebarNodes nodes={tree.children} pathname={pathname} level={0} />
        </div>
      </nav>
    </aside>
  );
}

interface SidebarNodesProps {
  nodes: Node[];
  pathname: string;
  level: number;
}

function SidebarNodes({ nodes, pathname, level }: SidebarNodesProps) {
  return (
    <div className="space-y-1">
      {nodes.map((node, index) => (
        <SidebarNode
          key={index}
          node={node}
          pathname={pathname}
          level={level}
        />
      ))}
    </div>
  );
}

interface SidebarNodeProps {
  node: Node;
  pathname: string;
  level: number;
}

function SidebarNode({ node, pathname, level }: SidebarNodeProps) {
  if (node.type === "separator") {
    return (
      <div className="pt-4 first:pt-0">
        <h5 className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
          {node.name}
        </h5>
      </div>
    );
  }

  if (node.type === "folder") {
    return (
      <div>
        <span className="block px-2 py-2 text-sm font-medium text-foreground/80">
          {node.name}
        </span>
        {node.children && (
          <ul className="ml-3 mt-1 space-y-1 border-l border-border pl-3">
            {node.children.map((child, index) => (
              <SidebarNode
                key={index}
                node={child}
                pathname={pathname}
                level={level + 1}
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  const isActive = pathname === node.url;

  return (
    <li className="list-none">
      <Link
        href={node.url}
        className={cn(
          "flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-[var(--accent-muted)] text-[var(--accent)] font-medium"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <span>{node.name}</span>
      </Link>
    </li>
  );
}
