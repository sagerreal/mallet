/**
 * Shared confirmation screen for the Stripe Checkout return routes (/pay/success, /pay/cancel).
 * The customer lands here after the hosted-Checkout redirect. Presentational; the payment is
 * recorded server-side (webhook primary, success-page reconcile secondary), so this screen only
 * reports the outcome. Functional copy — states what happened and what to do next, no chatty
 * filler. `confirmed` is the upgraded success state shown once the reconcile endpoint verified
 * the session server-side and the money is in the ledger.
 */
import type { ReactNode } from "react";

type Variant = "success" | "confirmed" | "deposit" | "depositConfirmed" | "cancel";

const COPY: Record<Variant, { title: string; body: ReactNode; mark: string }> = {
  success: {
    title: "Payment received",
    body: "Thank you — your payment went through. You can close this page.",
    mark: "✓",
  },
  confirmed: {
    title: "Payment confirmed",
    body: "Thank you — your payment went through and the invoice has been updated. You can close this page.",
    mark: "✓",
  },
  // A deposit settles on the QUOTE, and there is no invoice yet — saying one was updated would be
  // a promise about a document that does not exist. What the customer needs to know is that the
  // deposit is paid and it comes off the final bill.
  //
  // `deposit` is the NEUTRAL state and it is load-bearing: it is what shows when the server could
  // not confirm the deposit reached the quote. It says only what is certainly true — the card
  // went through — and claims nothing about the bill. Only `depositConfirmed`, reached solely on
  // a verified `recorded: true`, makes that second claim.
  deposit: {
    title: "Deposit received",
    body: "Thank you — your deposit went through. You can close this page.",
    mark: "✓",
  },
  depositConfirmed: {
    title: "Deposit confirmed",
    body: "Thank you — your deposit is recorded and will be taken off your final bill. You can close this page.",
    mark: "✓",
  },
  cancel: {
    title: "Payment canceled",
    body: "No charge was made. You can close this page, or reopen your payment link to try again.",
    mark: "×",
  },
};

export function PayResult({ variant }: { variant: Variant }) {
  const { title, body, mark } = COPY[variant];
  const badge = variant === "cancel" ? "cancel" : "success";
  return (
    <main className="payresult-wrap">
      <style>{PAYRESULT_CSS}</style>
      <div className="payresult-card">
        <span className={`payresult-badge payresult-badge--${badge}`} aria-hidden="true">
          {mark}
        </span>
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
    </main>
  );
}

// Scoped styling for the standalone return pages. Design tokens (--ink, --line, --bg, --card) come
// from the root layout's globals.css/prototype.css, available on public routes; hex fallbacks keep
// it correct if a token is ever absent.
const PAYRESULT_CSS = `
.payresult-wrap { min-height: 100dvh; display: flex; align-items: center; justify-content: center;
  padding: 40px 18px; background: var(--bg, #F4F1EA); font-family: inherit; }
.payresult-card { width: 100%; max-width: 420px; background: var(--card, #fff);
  border: 1px solid var(--line, #e7e2d6); border-radius: 16px; padding: 32px 28px; text-align: center;
  box-shadow: 0 4px 24px rgba(43,39,32,.06); }
.payresult-badge { display: inline-flex; align-items: center; justify-content: center; width: 46px;
  height: 46px; border-radius: 50%; font-size: 24px; font-weight: 700; margin-bottom: 16px; }
.payresult-badge--success { background: rgba(46,125,82,.12); color: var(--green, #2e7d52); }
.payresult-badge--cancel { background: rgba(148,153,161,.15); color: var(--ink-3, #9499a1); }
.payresult-card h1 { font-size: 20px; font-weight: 700; color: var(--ink, #15110b); margin: 0 0 8px;
  letter-spacing: -.01em; }
.payresult-card p { font-size: 14px; line-height: 1.5; color: var(--ink-2, #5b5750); margin: 0; }
`;
