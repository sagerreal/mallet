"use client";
import { useState, type FormEvent } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useAssistant } from "@/features/assistant/use-assistant";
import { ApprovalCard } from "@/features/assistant/approval-card";

export default function AssistantPage() {
  const { items, pending, busy, error, send, approveAll, denyAll } = useAssistant();
  const [draft, setDraft] = useState("");
  const notConfigured = error === "That feature isn't set up yet for this account.";

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    send(draft.trim());
    setDraft("");
  };

  return (
    <div className="flex min-h-[70dvh] flex-col">
      <PageHeader title="Assistant" />
      <div className="flex-1 space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Ask the assistant" hint='Try "list our customers" or "draft a quote for Karen — 2 hours of labor at $150".' />
        ) : (
          items.map((item, i) => (
            <div key={i} className={`max-w-[90%] rounded-card border p-3 text-sm ${item.role === "user" ? "ml-auto border-line bg-paper" : "border-line bg-card"}`}>
              <p className="whitespace-pre-wrap">{item.text}</p>
            </div>
          ))
        )}
        {pending.length > 0 ? <ApprovalCard pending={pending} busy={busy} onApprove={approveAll} onDeny={denyAll} /> : null}
        {busy ? <p className="text-sm text-ink-muted">Working…</p> : null}
        {error && !notConfigured ? <p className="text-sm text-red">{error}</p> : null}
        {notConfigured ? <EmptyState title="Assistant isn't configured" hint="Add the Anthropic API key to enable it." /> : null}
      </div>
      <form onSubmit={onSubmit} className="mt-4 flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask, or tell it what to do…" aria-label="Message" />
        <Button type="submit" disabled={busy || !draft.trim()}>Send</Button>
      </form>
    </div>
  );
}
