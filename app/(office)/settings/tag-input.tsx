"use client";

// Chip/tag input over a comma-separated string (the storage format for the playbook's
// keyword lists). Type a word or phrase, Enter/comma adds a chip, ✕ (or Backspace on an
// empty input) removes. In-flow, no floating UI — the chips live inside the bordered box.

import { useState } from "react";

export function parseTags(value: string): string[] {
  // Split on commas AND middle dots — legacy playbook values used "a · b · c" separators.
  return value.split(/[,·]/).map((t) => t.trim()).filter(Boolean);
}

export function joinTags(tags: readonly string[]): string {
  return tags.join(", ");
}

export function TagInput({
  value,
  onChange,
  placeholder,
  maxWidth = 560,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxWidth?: number;
}) {
  const tags = parseTags(value);
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const t = draft.trim().replace(/,+$/, "").trim();
    if (!t) { setDraft(""); return; }
    if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      onChange(joinTags([...tags, t]));
    }
    setDraft("");
  }

  function removeTag(i: number) {
    onChange(joinTags(tags.filter((_, idx) => idx !== i)));
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-2)",
        border: "1.5px solid var(--line)",
        borderRadius: "var(--radius-sm)",
        padding: "var(--space-1) var(--space-2)",
        background: "var(--card)",
        maxWidth,
        cursor: "text",
      }}
      onClick={(e) => {
        const input = (e.currentTarget as HTMLDivElement).querySelector("input");
        input?.focus();
      }}
    >
      {tags.map((t, i) => (
        <span
          key={`${t}-${i}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            fontSize: "var(--type-base)",
            fontWeight: 600,
            padding: "var(--space-1) var(--space-1) var(--space-1) var(--space-3)",
            borderRadius: "var(--radius-xl)",
            border: "1px solid var(--line)",
            background: "var(--manila, var(--bg))",
            color: "var(--ink)",
            whiteSpace: "nowrap",
          }}
        >
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={(e) => { e.stopPropagation(); removeTag(i); }}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--ink-3)",
              fontSize: "var(--type-sm)",
              lineHeight: 1,
              padding: "var(--space-2xs) var(--space-1)",
              fontFamily: "inherit",
            }}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        placeholder={tags.length === 0 ? placeholder : undefined}
        onChange={(e) => {
          const v = e.target.value;
          // A typed comma commits the phrase before it.
          if (v.endsWith(",")) { setDraft(v.slice(0, -1)); commitOn(v.slice(0, -1)); return; }
          setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commitDraft(); }
          if (e.key === "Backspace" && draft === "" && tags.length > 0) removeTag(tags.length - 1);
        }}
        onBlur={commitDraft}
        style={{
          flex: 1,
          minWidth: 140,
          border: "none",
          outline: "none",
          background: "transparent",
          fontFamily: "inherit",
          fontSize: "var(--type-base)",
          padding: "var(--space-1) var(--space-2xs)",
          color: "var(--ink)",
        }}
      />
    </div>
  );

  // Commit a specific phrase (used by the typed-comma path where state hasn't flushed yet).
  function commitOn(raw: string) {
    const t = raw.trim();
    if (!t) { setDraft(""); return; }
    if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      onChange(joinTags([...tags, t]));
    }
    setDraft("");
  }
}
