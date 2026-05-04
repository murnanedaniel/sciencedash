"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Item = {
  id: string;
  label: string;
  sub?: string;
  action: () => void;
  kbd?: string;
};

export function CommandPalette({
  projects,
  papers,
  programmes,
}: {
  projects: Array<{ id: string; title: string }>;
  papers: Array<{ id: string; title: string }>;
  programmes: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setSelected(0);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        close();
      } else if (!isMeta && e.key === "/" && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      } else if (!isMeta && !isTyping(e.target)) {
        // g-{key} quick jumps
        if (e.key === "g") {
          const handler = (ev: KeyboardEvent) => {
            const map: Record<string, string> = {
              t: "/",
              m: "/programmes",
              p: "/projects",
              a: "/papers",
              r: "/runs",
              n: "/reading",
              o: "/portfolio",
              s: "/settings",
            };
            const path = map[ev.key];
            if (path) {
              ev.preventDefault();
              router.push(path);
            }
            window.removeEventListener("keydown", handler, true);
          };
          window.addEventListener("keydown", handler, true);
          setTimeout(() => window.removeEventListener("keydown", handler, true), 1200);
        } else if (e.key === "n") {
          router.push("/projects/new");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, router]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const base: Item[] = [
      {
        id: "go-today",
        label: "Go to Today",
        sub: "home",
        action: () => router.push("/"),
        kbd: "g t",
      },
      {
        id: "new-project",
        label: "New project",
        sub: "projects/new",
        action: () => router.push("/projects/new"),
        kbd: "n",
      },
      {
        id: "go-portfolio",
        label: "Portfolio",
        sub: "outer loop",
        action: () => router.push("/portfolio"),
        kbd: "g o",
      },
      {
        id: "go-papers",
        label: "Papers kanban",
        sub: "papers",
        action: () => router.push("/papers"),
        kbd: "g a",
      },
      {
        id: "go-programmes",
        label: "Programmes",
        sub: "programmes",
        action: () => router.push("/programmes"),
        kbd: "g m",
      },
      {
        id: "new-programme",
        label: "New programme",
        sub: "programmes/new",
        action: () => router.push("/programmes/new"),
      },
    ];
    for (const p of projects) {
      base.push({
        id: `project-${p.id}`,
        label: p.title,
        sub: "project",
        action: () => router.push(`/projects/${p.id}`),
      });
    }
    for (const p of papers) {
      base.push({
        id: `paper-${p.id}`,
        label: p.title,
        sub: "paper",
        action: () => router.push(`/papers/${p.id}`),
      });
    }
    for (const p of programmes) {
      base.push({
        id: `programme-${p.id}`,
        label: p.name,
        sub: "programme",
        action: () => router.push(`/programmes/${p.id}`),
      });
    }
    return base;
  }, [projects, papers, programmes, router]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items.slice(0, 30);
    return items
      .filter((i) =>
        (i.label + " " + (i.sub ?? "")).toLowerCase().includes(needle),
      )
      .slice(0, 30);
  }, [items, q]);

  useEffect(() => {
    setSelected(0);
  }, [q, open]);

  if (!open) return null;

  function act(i: Item) {
    close();
    i.action();
  }

  return (
    <div className="palette" onClick={close}>
      <div className="paletteBox" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="paletteInput"
          placeholder="Jump to project, paper, or action…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              setSelected((s) => Math.min(s + 1, filtered.length - 1));
              e.preventDefault();
            } else if (e.key === "ArrowUp") {
              setSelected((s) => Math.max(0, s - 1));
              e.preventDefault();
            } else if (e.key === "Enter") {
              const it = filtered[selected];
              if (it) act(it);
              e.preventDefault();
            }
          }}
        />
        <div className="paletteList">
          {filtered.length === 0 ? (
            <div className="paletteItem muted">No matches.</div>
          ) : (
            filtered.map((i, idx) => (
              <div
                key={i.id}
                className={`paletteItem ${idx === selected ? "active" : ""}`}
                onMouseEnter={() => setSelected(idx)}
                onClick={() => act(i)}
              >
                <div>
                  <div>{i.label}</div>
                  {i.sub ? <div className="muted small">{i.sub}</div> : null}
                </div>
                {i.kbd ? <span className="kbd">{i.kbd}</span> : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return true;
  return false;
}
