"use client";

/**
 * Settings → Ways leads reach you → "Lead marketplaces" card. Angi + Thumbtack mint a per-shop
 * webhook URL (via v1.inbound.generate) to paste into the platform's own integration settings —
 * the platform posts leads to it directly. State flips Not set up → Awaiting first lead →
 * Connected once a lead actually arrives (lastLeadAt set), not on mint. Google LSA + Yelp have no
 * webhook integration yet — shown as plain muted text, not a dead button. In-flow reveal (no
 * floating UI); copy is functional.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { FoldCard } from "./fold-card";

function origin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

const rel = (iso: string | null): string => {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

// Webhook-based marketplaces: "connect" mints a per-shop URL to paste into the platform. Angi posts
// JSON to it (x-api-key partner header); Thumbtack posts its Leads webhook. State flips to Connected
// once the first lead actually arrives (last_lead_at set) — not on mint.
function ConnectRow({ channel, label, steps }: { channel: "angi" | "thumbtack"; label: string; steps: string }) {
  const utils = api.useUtils();
  const list = api.v1.inbound.list.useQuery();
  const generate = api.v1.inbound.generate.useMutation({ onSuccess: () => utils.v1.inbound.list.invalidate() });
  const [copied, setCopied] = useState(false);
  const ep = list.data?.find((e) => e.channel === channel);
  const url = ep ? `${origin()}/api/inbound/${channel}/${ep.token}` : "";
  const state = !ep ? "Not set up" : ep.connected ? `Connected · last lead ${rel(ep.lastLeadAt)}` : "Awaiting first lead";

  return (
    <div className="stage-row" style={{ display: "block" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <b style={{ flex: 1 }}>{label}</b>
        <span className="muted" style={{ fontSize: 12 }}>{state}</span>
        {!ep && (
          <button className="btn sm" disabled={generate.isPending} onClick={() => generate.mutate({ channel })}>
            {generate.isPending ? "…" : "Get webhook URL"}
          </button>
        )}
      </div>
      {ep && (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value={url} style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "7px 9px", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }} />
            <button className="btn sm" onClick={() => { void navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>{steps}</p>
        </div>
      )}
    </div>
  );
}

export function LeadMarketplacesCard() {
  return (
    <FoldCard title="Lead marketplaces" summary="Angi · Thumbtack">
      <ConnectRow channel="angi" label="Angi" steps="In Angi, email crmintegrations@angi.com with this webhook URL to route your leads here." />
      <ConnectRow channel="thumbtack" label="Thumbtack" steps="In Thumbtack → integrations, add this URL as a custom lead webhook." />
      <div className="stage-row">
        <b>Google LSA</b><span className="muted" style={{ fontSize: 12 }}>Not available yet</span>
      </div>
      <div className="stage-row">
        <b>Yelp</b><span className="muted" style={{ fontSize: 12 }}>Not available yet</span>
      </div>
    </FoldCard>
  );
}
