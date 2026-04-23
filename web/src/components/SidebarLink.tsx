"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SidebarLink({
  href,
  label,
  hotkey,
}: {
  href: string;
  label: string;
  hotkey?: string;
}) {
  const pathname = usePathname() ?? "";
  const active =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={`navLink${active ? " navLinkActive" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <span>{label}</span>
      {hotkey ? <span className="navHotkey">{hotkey}</span> : null}
    </Link>
  );
}
