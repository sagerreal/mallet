"use client";

/**
 * Public, shop-branded "request service" form page. Shareable as a link (…/f/{token}) and
 * embeddable via <iframe>. Resolves the shop's brand name from the token via the inbound route's
 * GET, then renders the form. An inactive/unknown token shows a plain "not active" message.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { LeadForm } from "@/components/inbound/lead-form";

export default function PublicLeadFormPage() {
  const { token } = useParams<{ token: string }>();
  const [brandName, setBrandName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/inbound/form/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not active"))))
      .then((d: { brand: { name: string } }) => setBrandName(d.brand.name))
      .catch(() => setNotFound(true));
  }, [token]);

  return (
    <main className="leadform-wrap">
      <style>{LEADFORM_CSS}</style>
      {notFound ? (
        <p className="muted">This form link isn’t active.</p>
      ) : brandName === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <LeadForm token={token} brandName={brandName} />
      )}
    </main>
  );
}

// Scoped, warm-themed styling for the standalone/iframe-embedded form. Kept in this feature file
// (not the shared prototype.css) to avoid cross-session contention; design tokens (--ink, --line,
// --bg, --card) come from the root layout's globals.css/prototype.css, available on public routes.
const LEADFORM_CSS = `
.leadform-wrap { min-height: 100dvh; display: flex; align-items: flex-start; justify-content: center;
  padding: 40px 18px; background: var(--bg, #F4F1EA); font-family: inherit; }
.leadform, .leadform-done { width: 100%; max-width: 460px; background: var(--card, #fff);
  border: 1px solid var(--line, #e7e2d6); border-radius: 16px; padding: 28px 26px;
  box-shadow: 0 4px 24px rgba(43,39,32,.06); }
.leadform h1 { font-size: 20px; font-weight: 700; color: var(--ink, #15110b); margin: 0 0 18px; letter-spacing: -.01em; }
.leadform-field { display: block; margin-bottom: 14px; }
.leadform-field span { display: block; font-size: 12px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .05em; color: var(--ink-3, #9499a1); margin-bottom: 5px; }
.leadform-field input, .leadform-field textarea { width: 100%; box-sizing: border-box;
  border: 1.5px solid var(--line, #e7e2d6); border-radius: 9px; padding: 10px 12px; font-size: 14px;
  font-family: inherit; background: var(--bg, #fdfbf7); color: var(--ink, #15110b); outline: none;
  transition: border-color .12s, box-shadow .12s; }
.leadform-field input:focus, .leadform-field textarea:focus { border-color: var(--ink, #15110b);
  box-shadow: 0 0 0 3px rgba(21,17,11,.06); }
.leadform-field textarea { resize: vertical; }
.leadform-submit { width: 100%; min-height: 46px; margin-top: 4px; border-radius: 10px;
  border: 1.6px solid var(--ink, #15110b); background: var(--ink, #15110b); color: var(--bg, #fff);
  font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer; transition: opacity .12s; }
.leadform-submit:hover { opacity: .85; }
.leadform-submit:disabled { opacity: .45; cursor: not-allowed; }
.leadform-error { color: var(--red, #b23a2a); font-size: 13px; margin: 0 0 12px; }
.leadform-done h2 { font-size: 20px; font-weight: 700; color: var(--ink, #15110b); margin: 0 0 6px; }
.leadform-wrap .muted { color: var(--ink-3, #9499a1); font-size: 14px; }
`;
