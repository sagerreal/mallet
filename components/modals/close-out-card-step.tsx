"use client";

/**
 * components/modals/close-out-card-step.tsx
 * The close-out PayBlock's CARD step — a REAL Stripe Checkout presented as a QR
 * code the customer scans (plus an "Open payment page" link for handing the
 * device over). Replaces the old "simulated tap" theater, which recorded money
 * that was never charged.
 *
 * Flow: on entry, mint the checkout session ONCE (a draft is SENT first —
 * createPayment refuses drafts), render the QR, then poll the invoice every 4s.
 * The Stripe webhook records the payment server-side, so the poll only READS
 * status; when it flips paid/partial the fresh DTO goes to the parent (adopt +
 * done step). Every failure keeps the "record it instead" fallback visible —
 * never a dead end.
 */

import { useEffect, useRef, useState } from "react";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { userMessage } from "@/lib/trpc/error-map";
import { CheckoutQr } from "@/components/shared/checkout-qr";
import type { Invoice } from "@/lib/store/types";
import type { InvoiceDTO } from "@/lib/store/dto-mapper";

const POLL_MS = 4_000;
/** Wall-clock cap on the poll (precedent: the field surface's bounded refetching). */
const POLL_CAP_MS = 5 * 60_000;
const MINT_FALLBACK = "Couldn't start the card payment. Try again.";
const SEND_FALLBACK = "Couldn't send the invoice — check your connection and try again.";

/** fmt$ — integer dollars → "$N,NNN" (same figure style as the rest of the close-out). */
function fmtDollars(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export interface CardCheckoutStepProps {
  invoice: Invoice;
  /** Dollars — the FULL balance: createPayment always charges the invoice balance. */
  amount: number;
  /** The store's sendInvoice — a draft must be genuinely SENT before minting. */
  sendInvoice: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** The poll saw the invoice flip paid/partial — the parent adopts the DTO and advances. */
  onPaid: (dto: InvoiceDTO) => void;
  /** "They paid another way — record it instead." Falls back to the record step. */
  onRecordInstead: () => void;
  onCancel: () => void;
}

export function CardCheckoutStep({
  invoice,
  amount,
  sendInvoice,
  onPaid,
  onRecordInstead,
  onCancel,
}: CardCheckoutStepProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  // Refs, not state: mint-once across re-renders (and StrictMode's double effect
  // run), a lifetime flag for the async mint, the latest onPaid for the interval
  // closure, and a single-fire guard against overlapping in-flight polls.
  const mintedRef = useRef(false);
  const aliveRef = useRef(true);
  const settledRef = useRef(false);
  const onPaidRef = useRef(onPaid);

  useEffect(() => {
    onPaidRef.current = onPaid;
  });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // ---- mint the checkout session ONCE on entry -----------------------------
  useEffect(() => {
    if (mintedRef.current) return;
    mintedRef.current = true;
    void (async () => {
      try {
        // createPayment refuses drafts (sent|partial only) — send first, and only
        // proceed once the send GENUINELY landed (sendInvoice resolves, never rejects).
        if (invoice.status === "draft") {
          const sent = await sendInvoice(invoice.id);
          if (!sent.ok) {
            if (aliveRef.current) setError(sent.error ?? SEND_FALLBACK);
            return;
          }
        }
        const session = await trpcVanilla.v1.invoicing.createPayment.mutate({
          invoiceId: invoice.id,
        });
        if (aliveRef.current) setUrl(session.url);
      } catch (err: unknown) {
        // Domain refusals pass their own sentence through userMessage —
        // PRECONDITION_FAILED here is "this shop hasn't finished Stripe payment
        // setup…"; anything unmapped gets the fixed fallback, never raw provider text.
        if (aliveRef.current) setError(userMessage(err, MINT_FALLBACK));
      }
    })();
  }, [invoice.id, invoice.status, sendInvoice]);

  // ---- poll the invoice while the QR is up ----------------------------------
  // The webhook is the source of truth for RECORDING the payment; this only reads
  // status. createPayment charges the FULL balance, so a completed session lands
  // as "paid"; "partial" is treated as paid-progress and advances the same way
  // (the DTO carries exactly what was recorded).
  useEffect(() => {
    if (!url || expired) return;
    const startedAt = Date.now();
    const iv = setInterval(() => {
      if (Date.now() - startedAt >= POLL_CAP_MS) {
        clearInterval(iv);
        setExpired(true);
        return;
      }
      trpcVanilla.v1.invoicing.get
        .query({ invoiceId: invoice.id })
        .then((dto) => {
          if (dto.status !== "paid" && dto.status !== "partial") return;
          if (settledRef.current) return;
          settledRef.current = true;
          clearInterval(iv);
          onPaidRef.current(dto);
        })
        .catch(() => {
          // Transient poll failure (offline blip, 500) — deliberately kept quiet and
          // polling continues: the webhook already recorded any payment, and the
          // wall-clock cap's sentence covers a line that stays dead.
        });
    }, POLL_MS);
    return () => clearInterval(iv);
  }, [url, expired, invoice.id]);

  return (
    <div className="cotap">
      <div className="cotap-amt fig">{fmtDollars(amount)}</div>

      {error ? (
        <p
          role="alert"
          style={{
            color: "var(--red)",
            fontSize: "var(--type-base)",
            fontWeight: 600,
            margin: "var(--space-3) 0 0",
          }}
        >
          {error}
        </p>
      ) : url ? (
        <>
          <div style={{ margin: "var(--space-4) 0 var(--space-3)" }}>
            <CheckoutQr url={url} />
          </div>
          <div className="cotap-msg">Scan to pay by card</div>
          <a
            className="linklike"
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-block", marginTop: "var(--space-2)" }}
          >
            Open payment page
          </a>
          {expired ? (
            <p style={{ fontSize: "var(--type-sm)", margin: "var(--space-3) 0 0" }}>
              No payment has come through after 5 minutes — the payment page still works
              if they&rsquo;re mid-payment.
            </p>
          ) : (
            <div className="cotap-sub">Card payment · powered by Stripe</div>
          )}
        </>
      ) : (
        <div className="cotap-msg" style={{ marginTop: "var(--space-3)" }}>
          Starting the card payment…
        </div>
      )}

      {/* ALWAYS visible — a dead checkout must never strand the tech at the door. */}
      <div style={{ marginTop: "var(--space-4)" }}>
        <span className="linklike" onClick={onRecordInstead}>
          They paid another way — record it instead
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          justifyContent: "center",
          marginTop: "var(--space-3)",
        }}
      >
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
