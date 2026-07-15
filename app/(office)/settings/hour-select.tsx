"use client";

export function hourLabel(h: number): string {
  if (h === 0) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  if (h === 24) return "Midnight";
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}

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
      style={{
        border: "1.5px solid var(--line)",
        borderRadius: 7,
        padding: "6px 8px",
        fontFamily: "inherit",
        fontSize: 13,
      }}
    >
      {options.map((h) => (
        <option key={h} value={h}>{hourLabel(h)}</option>
      ))}
    </select>
  );
}
