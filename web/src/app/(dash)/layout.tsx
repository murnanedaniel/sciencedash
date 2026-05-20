import { SidebarLink } from "@/components/SidebarLink";
import { CommandPalette } from "@/components/CommandPalette";
import { HelpButton } from "@/components/HelpButton";
import { prisma } from "@/lib/prisma";

// Every dashboard page reads live data from SQLite. Opt out of Next's
// static prerender so pages reflect the current DB on every request
// (not the empty DB that existed at build time).
export const dynamic = "force-dynamic";

export default async function DashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [projects, papers, programmes] = await Promise.all([
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
    prisma.programme.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 100,
    }),
  ]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <nav className="navStack">
          <SidebarLink href="/" label="Today" hotkey="g T" />
          <SidebarLink href="/chat" label="Chat" hotkey="g C" />
          <SidebarLink href="/programmes" label="Programmes" hotkey="g M" />
          <SidebarLink href="/projects" label="Projects" hotkey="g P" />
          <SidebarLink href="/papers" label="Papers" hotkey="g A" />
          <SidebarLink href="/runs" label="Runs" hotkey="g R" />
          <SidebarLink href="/reading" label="Reading" hotkey="g N" />
          <div className="navDivider" />
          <SidebarLink href="/portfolio" label="Portfolio" hotkey="g O" />
          <SidebarLink href="/brain-chat" label="Brain chat" hotkey="g B" />
          <div className="navDivider" />
          <SidebarLink href="/settings" label="Settings" hotkey="g S" />
          <div className="navDivider" />
          <div className="muted small" style={{ padding: "6px 12px", lineHeight: 1.5 }}>
            ⌘K · palette
            <br />? · help
            <br />n · new project
          </div>
          <div className="navDivider" />
          <form
            action="/api/auth/logout"
            method="post"
            style={{ padding: "6px 12px" }}
          >
            <button
              type="submit"
              className="muted small"
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                font: "inherit",
              }}
            >
              Log out
            </button>
          </form>
        </nav>
      </aside>
      <div className="main">{children}</div>
      <CommandPalette projects={projects} papers={papers} programmes={programmes} />
      <HelpButton />
    </div>
  );
}
