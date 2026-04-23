import { SidebarLink } from "@/components/SidebarLink";
import { CommandPalette } from "@/components/CommandPalette";
import { prisma } from "@/lib/prisma";

export default async function DashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [projects, papers] = await Promise.all([
    prisma.project.findMany({
      select: { id: true, title: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.paper.findMany({
      select: { id: true, title: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <nav className="navStack">
          <SidebarLink href="/" label="Today" hotkey="T" />
          <SidebarLink href="/projects" label="Projects" hotkey="P" />
          <SidebarLink href="/papers" label="Papers" hotkey="A" />
          <SidebarLink href="/runs" label="Runs" hotkey="R" />
          <SidebarLink href="/reading" label="Reading" hotkey="N" />
          <div className="navDivider" />
          <SidebarLink href="/ingredients" label="Ingredients" hotkey="I" />
          <SidebarLink href="/portfolio" label="Portfolio" hotkey="O" />
          <div className="navDivider" />
          <SidebarLink href="/settings" label="Settings" hotkey="S" />
          <div className="navDivider" />
          <div className="muted small" style={{ padding: "6px 12px" }}>
            ⌘K · command
          </div>
        </nav>
      </aside>
      <div className="main">{children}</div>
      <CommandPalette projects={projects} papers={papers} />
    </div>
  );
}
