"use client";

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: readonly SegmentedOption<T>[];
  size?: "md" | "sm";
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: SegmentedProps<T>) {
  const pad = size === "sm" ? "5px 10px" : "7px 14px";
  const fs = size === "sm" ? 12 : 13;

  return (
    <div
      style={{
        display: "inline-flex",
        border: "1.5px solid var(--line)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--card)",
      }}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            style={{
              padding: pad,
              fontSize: fs,
              fontWeight: 600,
              fontFamily: "inherit",
              border: "none",
              borderLeft: i === 0 ? "none" : "1px solid var(--line)",
              cursor: "pointer",
              transition: "background .12s, color .12s",
              background: selected ? "var(--ink)" : "transparent",
              color: selected ? "var(--bg, #FCFBF7)" : "var(--ink-2, #585D66)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
