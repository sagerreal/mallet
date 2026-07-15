"use client";

// Thin wrapper over the app's `.seg` toggle (prototype.css) — the same control the composer
// uses for Single quote | Good, Better & Best. Selected option = filled ink pill.
// No custom styling here: the design system owns the look.

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: readonly SegmentedOption<T>[];
  "aria-label"?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
