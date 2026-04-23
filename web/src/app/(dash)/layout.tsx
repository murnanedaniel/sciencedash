import { SidebarLink } from "@/components/SidebarLink";

export default function DashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
          <SidebarLink href="/ingredients" label="Ingredients" />
          <SidebarLink href="/portfolio" label="Portfolio" />
          <div className="navDivider" />
          <SidebarLink href="/settings" label="Settings" />
        </nav>
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}
