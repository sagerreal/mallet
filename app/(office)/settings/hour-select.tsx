"use client";

// 12-hour time select over INTEGER hours (the storage format, 0–24). Rides the app's `.tsel`
// styled select (prototype.css) — same chevroned control the team-roles rows use — so the
// closed state looks native to the app rather than the raw OS box.

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
    <select className="tsel" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map((h) => (
        <option key={h} value={h}>{hourLabel(h)}</option>
      ))}
    </select>
  );
}
