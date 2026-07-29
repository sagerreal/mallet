"use client";

import { SelectMenu } from "@/components/ui/select-menu";

// 12-hour time select over INTEGER hours (the storage format, 0–24).
//
// `.tsel` styled the CLOSED box and could do nothing about the open list, which the operating
// system drew — so a business-hours row showed fourteen app-styled boxes that each opened a grey
// macOS menu. SelectMenu draws both halves.

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
    <SelectMenu
      value={String(value)}
      onChange={(v) => onChange(Number(v))}
      options={options.map((h) => ({ value: String(h), label: hourLabel(h) }))}
      aria-label="Time"
      compact
    />
  );
}
