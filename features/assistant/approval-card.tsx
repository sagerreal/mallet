"use client";
import { Button } from "@/components/ui/button";
import type { PendingAction } from "./use-assistant";

const summarizeArgs = (argsJson: string): string => {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    return Object.entries(args).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("\n");
  } catch {
    return argsJson;
  }
};

export function ApprovalCard({ pending, busy, onApprove, onDeny }: { pending: PendingAction[]; busy: boolean; onApprove: () => void; onDeny: () => void }) {
  return (
    <div className="rounded-card border border-amber bg-amber-bg p-4">
      <p className="font-medium text-amber">The assistant wants to take an action</p>
      {pending.map((p) => (
        <div key={p.toolUseId} className="mt-2 rounded-control bg-card p-3 text-sm">
          <p className="font-medium">{p.tool.replace("_", " ")}</p>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-ink-muted">{summarizeArgs(p.argsJson)}</pre>
        </div>
      ))}
      <div className="mt-3 flex gap-2">
        <Button disabled={busy} onClick={onApprove}>Approve & continue</Button>
        <Button variant="quiet" disabled={busy} onClick={onDeny}>Deny</Button>
      </div>
    </div>
  );
}
