"use client";

/**
 * Public "request service" form embedded on (or linked from) a shop's website. Submits to
 * /api/inbound/form/[token], which resolves the org from the token and drops the lead into the
 * pipeline. Bot defenses: a hidden honeypot field + a minimum time-to-submit (both silently
 * drop, so a bot gets no signal). No floating UI.
 */

import { useState, useRef } from "react";

const MIN_SUBMIT_MS = 1500; // a submit faster than this is almost certainly a bot

export function LeadForm({ token, brandName }: { token: string; brandName: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mountedAt = useRef(Date.now());

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (String(form.get("company_website"))) return; // honeypot filled → silently drop
    if (Date.now() - mountedAt.current < MIN_SUBMIT_MS) return; // too fast → drop
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/inbound/form/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          phone: form.get("phone"),
          email: form.get("email"),
          address: form.get("address"),
          notes: form.get("notes"),
        }),
      });
      if (!res.ok) {
        setError("Something went wrong — please call us instead.");
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong — please call us instead.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="leadform-done">
        <h2>Thanks — we got it.</h2>
        <p className="muted">{brandName} will reach out shortly.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="leadform">
      <h1>Request service from {brandName}</h1>
      <label className="leadform-field">
        <span>Name</span>
        <input name="name" required maxLength={255} autoComplete="name" />
      </label>
      <label className="leadform-field">
        <span>Phone</span>
        <input name="phone" inputMode="tel" maxLength={40} autoComplete="tel" />
      </label>
      <label className="leadform-field">
        <span>Email</span>
        <input name="email" type="email" maxLength={320} autoComplete="email" />
      </label>
      <label className="leadform-field">
        <span>Service address</span>
        <input name="address" maxLength={500} autoComplete="street-address" />
      </label>
      <label className="leadform-field">
        <span>What do you need?</span>
        <textarea name="notes" maxLength={2000} rows={4} />
      </label>
      {/* honeypot: off-screen, not tab-reachable, tempting to bots */}
      <input
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
      />
      {error && <p className="leadform-error">{error}</p>}
      <button type="submit" className="leadform-submit" disabled={busy}>
        {busy ? "Sending…" : "Request service"}
      </button>
    </form>
  );
}
