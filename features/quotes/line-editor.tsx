"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type LineDraft = { description: string; quantity: number; rateDollars: string };

export function LineEditor({ lines, onChange }: { lines: LineDraft[]; onChange: (lines: LineDraft[]) => void }) {
  const update = (i: number, patch: Partial<LineDraft>) =>
    onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {lines.map((line, i) => (
        <div key={i} className="grid grid-cols-[1fr_5rem_7rem_auto] items-center gap-2">
          <Input
            placeholder="Description"
            value={line.description}
            onChange={(e) => update(i, { description: e.target.value })}
            required
          />
          <Input
            type="number"
            min={0.25}
            step={0.25}
            value={line.quantity}
            onChange={(e) => update(i, { quantity: Number(e.target.value) })}
            aria-label="Quantity"
          />
          <Input
            type="number"
            min={0}
            step={0.01}
            value={line.rateDollars}
            onChange={(e) => update(i, { rateDollars: e.target.value })}
            aria-label="Rate ($)"
            placeholder="Rate ($)"
          />
          <Button
            variant="quiet"
            onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
            aria-label="Remove line"
          >
            ✕
          </Button>
        </div>
      ))}
      <Button
        variant="quiet"
        onClick={() => onChange([...lines, { description: "", quantity: 1, rateDollars: "" }])}
      >
        Add line
      </Button>
    </div>
  );
}
