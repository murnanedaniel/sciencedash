"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ProjectOption = { id: string; title: string };

type Props = {
  projects: ProjectOption[];
  claudeModel: string;
  codexModel: string;
};

/**
 * Convene a forum. Topic is the only required field — the default roster is
 * Claude + Codex, which is the pairing the surface exists for.
 */
export function NewForumForm({ projects, claudeModel, codexModel }: Props) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [projectId, setProjectId] = useState("");
  const [turnBudget, setTurnBudget] = useState(6);
  const [claudePersona, setClaudePersona] = useState("");
  const [codexPersona, setCodexPersona] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/forum", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          projectId: projectId || null,
          turnBudget,
          participants: [
            {
              handle: "claude",
              driver: "claude",
              model: claudeModel,
              persona: claudePersona.trim(),
            },
            {
              handle: "codex",
              driver: "codex",
              model: codexModel,
              persona: codexPersona.trim(),
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push(`/forum/${data.forum.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" style={{ padding: 14 }} onSubmit={submit}>
      <div className="field">
        <label className="small muted" htmlFor="forum-topic">
          Topic
        </label>
        <textarea
          id="forum-topic"
          rows={3}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What should they discuss? e.g. “Is a GNN still the right backbone for ITk track finding, or should we be looking at transformers?”"
          style={{
            width: "100%",
            fontFamily: "inherit",
            fontSize: 14,
            resize: "vertical",
          }}
        />
      </div>

      <div className="row" style={{ gap: 12, flexWrap: "wrap", marginTop: 10 }}>
        <div className="field">
          <label className="small muted" htmlFor="forum-project">
            Project (optional)
          </label>
          <select
            id="forum-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">— none —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="small muted" htmlFor="forum-budget">
            Turns before it parks
          </label>
          <input
            id="forum-budget"
            type="number"
            min={1}
            max={40}
            value={turnBudget}
            onChange={(e) => setTurnBudget(Number(e.target.value))}
            style={{ width: 90 }}
          />
        </div>
      </div>

      <button
        type="button"
        className="link small"
        style={{
          background: "none",
          border: "none",
          padding: 0,
          marginTop: 10,
          cursor: "pointer",
        }}
        onClick={() => setAdvanced((v) => !v)}
      >
        {advanced ? "− personas" : "+ personas"}
      </button>

      {advanced ? (
        <div className="stackTight" style={{ marginTop: 8 }}>
          <div className="field">
            <label className="small muted" htmlFor="persona-claude">
              @claude <span className="muted">({claudeModel})</span>
            </label>
            <input
              id="persona-claude"
              value={claudePersona}
              onChange={(e) => setClaudePersona(e.target.value)}
              placeholder="e.g. argue from the physics side; be sceptical of ML-first framings"
              style={{ width: "100%" }}
            />
          </div>
          <div className="field">
            <label className="small muted" htmlFor="persona-codex">
              @codex <span className="muted">({codexModel})</span>
            </label>
            <input
              id="persona-codex"
              value={codexPersona}
              onChange={(e) => setCodexPersona(e.target.value)}
              placeholder="e.g. argue from implementation cost and what's actually shippable"
              style={{ width: "100%" }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="small" style={{ color: "var(--red, #c0322a)", marginTop: 8 }}>
          {error}
        </div>
      ) : null}

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button type="submit" className="button" disabled={!topic.trim() || busy}>
          {busy ? "Convening…" : "Convene forum"}
        </button>
      </div>
    </form>
  );
}
