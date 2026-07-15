"use client";

export function hourLabel(h: number): string {
  if (h === 0) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  if (h === 24) return "Midnight";
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}

// Styled select shared style — appearance:none + inline SVG chevron.
// Export so other selects in this tab can reuse it.
export const SELECT_STYLE: React.CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  border: "1.5px solid var(--line)",
  borderRadius: 7,
  padding: "6px 8px",
  paddingRight: 26,
  fontFamily: "inherit",
  fontSize: 13,
  backgroundColor: "var(--card)",
  color: "var(--ink)",
  backgroundImage:
    "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%23999\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 9l6 6 6-6\"/></svg>')",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 8px center",
  cursor: "pointer",
};

export function HourSelect({ value, onChange, min = 0, max = 23 }: {
  value: number;
  onChange: (h: number) => void;
  min?: number;
  max?: number;
}) {
  const options: number[] = [];
  for (let h = min; h <= max; h++) {
    options.push(h);
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={SELECT_STYLE}
    >
      {options.map((h) => (
        <option key={h} value={h}>{hourLabel(h)}</option>
      ))}
    </select>
  );
}
