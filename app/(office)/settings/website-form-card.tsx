"use client";

/**
 * Settings → Ways leads reach you → "Website form" card. Mints (via v1.inbound.generate) a
 * per-org form endpoint and reveals the shareable link + one-line iframe embed. Every submission
 * to that form lands in the pipeline. In-flow reveal (no floating UI). Copy is functional.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { FoldCard } from "./fold-card";
import { IconWell } from "./icon-well";

// The public form lives at <origin>/f/<token>. Match the app's existing client link-building
// (the quote link uses window.location.origin — see components/modals/estimate-modal.tsx).
function origin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, border: "1.5px solid var(--line)", borderRadius: 8,
  padding: "8px 10px", fontFamily: "inherit", fontSize: 13, background: "var(--card)", color: "var(--ink)",
};

export function WebsiteFormCard() {
  const utils = api.useUtils();
  const list = api.v1.inbound.list.useQuery();
  const generate = api.v1.inbound.generate.useMutation({
    onSuccess: () => utils.v1.inbound.list.invalidate(),
  });
  const [copied, setCopied] = useState("");

  const form = list.data?.find((e) => e.channel === "form");
  const link = form ? `${origin()}/f/${form.token}` : "";
  const iframe = `<iframe src="${link}" style="width:100%;max-width:480px;height:640px;border:0" title="Request service"></iframe>`;

  function copy(label: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  }

  return (
    <FoldCard title="Website form" summary={form ? "Live" : "Not set up"}>
      {!form ? (
        <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
          <IconWell>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18" />
              <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
            </svg>
          </IconWell>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="muted" style={{ fontSize: 13, margin: "1px 0 11px", lineHeight: 1.45 }}>
              A “request service” form for your website — share the link or embed it. Every submission lands in your pipeline.
            </p>
            <button className="btn primary" disabled={generate.isPending} onClick={() => generate.mutate({ channel: "form" })}>
              {generate.isPending ? "Creating…" : "Get your form"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Share this link</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input readOnly value={link} style={inputStyle} />
              <button className="btn" onClick={() => copy("link", link)}>{copied === "link" ? "Copied" : "Copy"}</button>
              <a className="btn ghost" href={link} target="_blank" rel="noopener noreferrer">Preview</a>
            </div>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Or embed on your site</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input readOnly value={iframe} style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }} />
              <button className="btn" onClick={() => copy("iframe", iframe)}>{copied === "iframe" ? "Copied" : "Copy"}</button>
            </div>
          </div>
        </div>
      )}
    </FoldCard>
  );
}
