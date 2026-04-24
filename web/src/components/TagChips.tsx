"use client";

import { useEffect, useRef, useState } from "react";
import { COMMON_TAGS } from "@/lib/commonTags";

type Props = {
  name: string;
  initial?: string;
  placeholder?: string;
  onCommit?: (value: string) => void; // optional: called with the final string on blur
};

/**
 * Tag input with a row of clickable common-tag chips. The underlying value
 * is still a single comma/space-separated string stored in an <input> named
 * `name`, so server actions receive the same shape as before.
 *
 * Clicking a chip toggles it in/out of the value. Selected chips highlight.
 */
export function TagChips({
  name,
  initial = "",
  placeholder = "tracking, hl-lhc, ingredient",
  onCommit,
}: Props) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setValue(initial), [initial]);

  const normalizedTokens = (s: string) =>
    s
      .split(/[\s,]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

  const selected = new Set(normalizedTokens(value));

  function toggle(tag: string) {
    const tokens = normalizedTokens(value);
    const idx = tokens.indexOf(tag);
    const next =
      idx >= 0
        ? tokens.filter((t) => t !== tag)
        : [...tokens, tag];
    setValue(next.join(", "));
    inputRef.current?.focus();
  }

  return (
    <div className="stackTight">
      <input
        ref={inputRef}
        type="text"
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => onCommit?.(e.target.value)}
        placeholder={placeholder}
      />
      <div className="tagChipRows">
        {COMMON_TAGS.map((group) => (
          <div key={group.group} className="tagChipRow">
            <span className="tagChipGroup">{group.group}</span>
            {group.tags.map((tag) => {
              const on = selected.has(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`tagChip${on ? " tagChipOn" : ""}`}
                  onClick={() => toggle(tag)}
                  aria-pressed={on}
                >
                  {on ? "✓ " : "+ "}
                  {tag}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
