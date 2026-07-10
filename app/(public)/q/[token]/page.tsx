/**
 * app/(public)/q/[token]/page.tsx
 *
 * Public customer quote page — no auth, no office chrome.
 * URL: /q/<64-hex-char-token>   (generated at draft time, 256 bits of entropy)
 *
 * Server component: calls getPublicQuote(token) which stamps first_viewed_at,
 * then renders a mobile-first branded quote. The approve/decline interaction is
 * delegated to the QuoteActions client island so the static markup is SSR-safe.
 *
 * Reuses custhead / custbody / custline / addonrow / deltabanner CSS classes from
 * prototype.css (same visual DNA as cust-quote-modal.tsx) but as a full page,
 * not a modal.
 *
 * Unknown token → friendly "link is no longer valid" page.
 * Already accepted/declined → show terminal state, no actions.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicQuote } from "@/modules/quoting/app/public-quote";
import { fmt$ } from "@/lib/format";
import { QuoteActions } from "./QuoteActions";

// Token format: 64 hex chars. Validate before hitting the DB.
const TOKEN_RE = /^[0-9a-f]{64}$/i;

interface Params {
  token: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return { title: "Quote — Mallet" };
  const view = await getPublicQuote(token);
  if (!view) return { title: "Quote — Mallet" };
  return {
    title: `Quote from ${view.orgName}`,
    description: `Review and approve your quote from ${view.orgName}.`,
    robots: { index: false, follow: false },
  };
}

// ---- helpers ---------------------------------------------------------------

function centsToDisplay(cents: number): string {
  return fmt$(cents / 100);
}

// ---- static line rows (non-optional) ---------------------------------------

function LineRow({
  description,
  quantity,
  rateCents,
}: {
  description: string;
  quantity: number;
  rateCents: number;
}) {
  const amount = Math.round(quantity * rateCents);
  return (
    <div className="custline">
      <span>
        {description}
        {quantity !== 1 ? ` × ${quantity}` : ""}
      </span>
      <b>{centsToDisplay(amount)}</b>
    </div>
  );
}

// ---- totals block ----------------------------------------------------------

function TotalsBlock({
  subtotalCents,
  discountCents,
  taxCents,
  totalCents,
  depositCents,
  discBps,
  taxBps,
  depBps,
}: {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  discBps: number;
  taxBps: number;
  depBps: number;
}) {
  const disc = discBps / 100; // bps → percent
  const tax = taxBps / 100;
  const dep = depBps / 100;
  const showSub = discBps > 0 || taxBps > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 4,
        padding: "14px 0 4px",
      }}
    >
      {showSub && (
        <div className="muted" style={{ fontSize: 12.5 }}>
          Subtotal {centsToDisplay(subtotalCents)}
        </div>
      )}
      {discBps > 0 && (
        <div className="muted" style={{ fontSize: 12.5 }}>
          Discount {disc}% −{centsToDisplay(discountCents)}
        </div>
      )}
      {taxBps > 0 && (
        <div className="muted" style={{ fontSize: 12.5 }}>
          Tax {tax}% +{centsToDisplay(taxCents)}
        </div>
      )}
      <div style={{ fontWeight: 900, fontSize: 19 }}>
        Total {centsToDisplay(totalCents)}
      </div>
      {dep > 0 && (
        <div className="muted" style={{ fontSize: 12 }}>
          {centsToDisplay(depositCents)} deposit due today &middot; the rest when the job&rsquo;s done
        </div>
      )}
    </div>
  );
}

// ---- page ------------------------------------------------------------------

export default async function PublicQuotePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { token } = await params;

  // Bad token format — 404 immediately.
  if (!TOKEN_RE.test(token)) {
    notFound();
  }

  const view = await getPublicQuote(token);

  if (!view) {
    // Token valid format but no match — friendly not-found page.
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 20px",
        }}
      >
        <div
          style={{
            maxWidth: 400,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 32,
              marginBottom: 16,
              color: "var(--ink-3)",
            }}
          >
            &#x2014;
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 20,
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            This quote link is no longer valid
          </h1>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            The link may have expired or been revoked. Contact the business
            directly for a fresh quote.
          </p>
          <p
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              marginTop: 32,
            }}
          >
            Powered by Mallet
          </p>
        </div>
      </main>
    );
  }

  const { estimate, orgName, customerFirstName } = view;
  const p = estimate.props;

  // Derive initials from org name for the brand badge.
  const initials = orgName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  const subtotalCents = estimate.subtotal();
  const discountCents = estimate.discountAmount();
  const taxCents = estimate.taxAmount();
  const totalCents = estimate.total();
  const depositCents = estimate.depositDue();

  const isAccepted = p.status === "accepted";
  const isDeclined = p.status === "declined";
  const isDone = isAccepted || isDeclined;

  // Fixed (non-optional) lines — the primary line set for this page.
  // Optional add-ons: the public page shows them as view-only rows marked "(optional)".
  // Interactive toggling is a deferred feature for when we model customer-selected addons
  // on the server; for now we show them statically so the quote is fully readable.
  const fixedLines = p.lines.filter((l) => !l.props.isOptional);
  const optLines = p.lines.filter((l) => l.props.isOptional);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0 0 40px",
      }}
    >
      {/* Quote card — max 520px, full-width on mobile */}
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: "0 0 16px 16px",
          overflow: "hidden",
          boxShadow: "var(--shadow)",
        }}
      >
        {/* Branded header */}
        <div className="custhead">
          <div className="custlogo">{initials}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{orgName}</div>
            <div style={{ fontSize: 11.5, opacity: 0.8 }}>
              Quote {p.num}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="custbody">
          {isAccepted ? (
            <>
              <div className="deltabanner" style={{ textAlign: "center" }}>
                Approved — thank you!
              </div>
              <p className="muted" style={{ textAlign: "center", marginTop: 8, fontSize: 12.5 }}>
                We&rsquo;ll be in touch to schedule the work.
              </p>
            </>
          ) : isDeclined ? (
            <>
              <div className="reqcard" style={{ textAlign: "center" }}>
                You passed on this one — no hard feelings.
              </div>
              <p className="muted" style={{ textAlign: "center", marginTop: 8, fontSize: 12.5 }}>
                Reach out any time if you change your mind.
              </p>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 6 }}>
                Here&rsquo;s your quote from <b>{orgName}</b>
                {customerFirstName ? `, ${customerFirstName}` : ""} — take a look.
              </p>

              {/* Fixed lines */}
              {fixedLines.map((line) => {
                const lp = line.props;
                return (
                  <LineRow
                    key={lp.id}
                    description={lp.description}
                    quantity={lp.quantity}
                    rateCents={lp.rate}
                  />
                );
              })}

              {/* Optional lines — view-only, marked */}
              {optLines.length > 0 && (
                <>
                  <div className="muted" style={{ fontSize: 11, marginTop: 12, marginBottom: 4 }}>
                    Optional add-ons (not included in total)
                  </div>
                  {optLines.map((line) => {
                    const lp = line.props;
                    const amount = Math.round(lp.quantity * lp.rate);
                    return (
                      <div key={lp.id} className="addonrow" style={{ cursor: "default" }}>
                        <span style={{ flex: 1 }}>
                          <b>Add:</b> {lp.description}
                          {lp.quantity !== 1 ? ` × ${lp.quantity}` : ""}
                        </span>
                        <b>+{centsToDisplay(amount)}</b>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Totals */}
              <TotalsBlock
                subtotalCents={subtotalCents}
                discountCents={discountCents}
                taxCents={taxCents}
                totalCents={totalCents}
                depositCents={depositCents}
                discBps={p.discBps}
                taxBps={p.taxBps}
                depBps={p.depBps}
              />

              {/* Approve / decline — client island */}
              {!isDone && (
                <QuoteActions token={token} totalCents={totalCents} />
              )}
            </>
          )}

          {/* Footer */}
          <p className="muted" style={{ fontSize: 10.5, textAlign: "center", marginTop: 16 }}>
            Powered by Mallet &mdash; licensed &amp; insured
          </p>
        </div>
      </div>

      {/* Valid-days notice below the card */}
      {p.validDays && !isDone && (
        <p
          className="muted"
          style={{
            marginTop: 12,
            fontSize: 12,
            textAlign: "center",
            maxWidth: 320,
            padding: "0 16px",
          }}
        >
          This quote is valid for {p.validDays} days from the date it was sent.
        </p>
      )}
    </main>
  );
}
