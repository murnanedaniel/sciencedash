"use client";

import { useEffect, useRef, useState, useTransition } from "react";

type Props = {
  value: string | null | undefined;
  field: string;
  projectId?: string;
  hypothesisId?: string;
  placeholder?: string;
  multiline?: boolean;
  action: (
    id: string,
    field: string,
    value: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  idForAction: string;
};

export function InlineField({
  value,
  field,
  placeholder,
  multiline,
  action,
  idForAction,
}: Props) {
  const [current, setCurrent] = useState(value ?? "");
  const [saved, setSaved] = useState<"" | "saving" | "saved" | "error">("");
  const [, startTransition] = useTransition();
  const latestRef = useRef(current);
  latestRef.current = current;

  useEffect(() => {
    setCurrent(value ?? "");
  }, [value]);

  async function commit(next: string) {
    setSaved("saving");
    startTransition(async () => {
      const res = await action(idForAction, field, next);
      if (res.ok) {
        setSaved("saved");
        setTimeout(() => setSaved(""), 900);
      } else {
        setSaved("error");
      }
    });
  }

  const commonProps = {
    value: current,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setCurrent(e.target.value),
    onBlur: () => {
      if ((value ?? "") !== current) commit(current);
    },
    placeholder,
    className: multiline ? "inlineTextarea" : "inlineInput",
  };

  return (
    <span className="inline">
      {multiline ? (
        <textarea rows={3} {...commonProps} />
      ) : (
        <input type="text" {...commonProps} />
      )}
      <span className={`inlineStatus ${saved ? "show" : ""}`}>
        {saved === "saving"
          ? "saving…"
          : saved === "saved"
            ? "saved"
            : saved === "error"
              ? "error"
              : ""}
      </span>
    </span>
  );
}
