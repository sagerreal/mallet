/**
 * app/(public)/i/[token]/PayInvoiceButton.tsx
 *
 * Client island for the one interaction on the public invoice page: start a Stripe-hosted
 * checkout for the balance. POSTs create_checkout to the public route and redirects to the
 * session URL. Errors render in-flow (anchored, no popovers), naming the problem.
 */

"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";

interface PayInvoiceButtonProps {
  readonly token: string;
  readonly balanceDueCents: number;
}

export function PayInvoiceButton({ token, balanceDueCents }: PayInvoiceButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/invoice/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_checkout" }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Couldn't start the payment — try again.");
        setBusy(false);
        return;
      }
      // Leave `busy` on through the redirect so the button can't double-fire.
      window.location.assign(data.url);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  const amount = formatMoney(balanceDueCents);

  return (
    <>
      {error && (
        <div
          role="alert"
          style={{
            background: "var(--red-bg)",
            border: "1px solid var(--red)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-2) var(--space-3)",
            fontSize: "var(--type-base)",
            color: "var(--red)",
            marginTop: "var(--space-3)",
          }}
        >
          {error}
        </div>
      )}
      <button
        className="btn primary"
        style={{
          width: "100%",
          padding: "var(--space-3)",
          fontSize: "var(--type-md)",
          marginTop: "var(--space-3)",
        }}
        onClick={() => void pay()}
        disabled={busy}
        aria-busy={busy}
        aria-label={`Pay ${amount} by card`}
      >
        {busy ? "Opening secure checkout…" : `Pay ${amount}`}
      </button>
      <p
        className="muted"
        style={{ fontSize: "var(--type-xs)", textAlign: "center", marginTop: "var(--space-2)" }}
      >
        Card payment via Stripe — you&rsquo;ll be taken to a secure checkout.
      </p>
    </>
  );
}
