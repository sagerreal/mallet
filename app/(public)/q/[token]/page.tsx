/**
 * app/(public)/q/[token]/page.tsx
 *
 * Public customer quote page — no auth, no office chrome.
 * URL: /q/<64-hex-char-token>   (generated at draft time, 256 bits of entropy)
 *
 * Server component: calls getPublicQuote(token) which stamps first_viewed_at,
 * then renders a mobile-first branded quote. Header, terminal states, fixed line
 * rows and footer are server-rendered; the optional add-on toggles, live totals
 * and approve/decline interaction are delegated to the QuoteLines client island
 * (which renders QuoteActions) so the static markup stays SSR-safe.
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
import { LineRow } from "./LineRow";
import { QuoteLines } from "./QuoteLines";
import { tierViewsFor } from "./tier-view";

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

// ---- terms -----------------------------------------------------------------

function TermsBlock({ text }: { text: string }) {
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line-2)" }}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
        Terms
      </div>
      <p
        style={{
          fontSize: 12,
          lineHeight: 1.55,
          margin: 0,
          whiteSpace: "pre-wrap",
          color: "var(--ink-2)",
        }}
      >
        {text}
      </p>
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

  const isAccepted = p.status === "accepted";
  const isDeclined = p.status === "declined";
  const isDone = isAccepted || isDeclined;

  // Good/Better/Best: non-null while the quote is tiered AND unresolved — the
  // QuoteLines island then renders the three-option picker + the selected tier's
  // lines instead of the server-rendered fixed rows below.
  const tierViews = tierViewsFor(estimate);

  // Single format: fixed (non-optional) lines stay server-rendered. Optional
  // add-ons are interactive: the QuoteLines client island renders them as toggles
  // and recomputes the totals + approve amount on every change. estimate.subtotal()
  // counts only non-optional lines, so it is the island's fixed base.
  const fixedLines = p.lines.filter((l) => !l.props.isOptional);
  const optLines = p.lines.filter((l) => l.props.isOptional);
  const fixedSubtotalCents = estimate.subtotal();

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

              {tierViews ? (
                /* Good/Better/Best: picker + selected tier's lines + totals + actions */
                <QuoteLines
                  tiers={tierViews.tiers}
                  recommendedTier={tierViews.recommendedTier}
                  discBps={p.discBps}
                  taxBps={p.taxBps}
                  depBps={p.depBps}
                  token={token}
                  changeAlreadyRequested={Boolean(p.changeRequestedAt)}
                />
              ) : (
                <>
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

                  {/* Optional add-on toggles + live totals + actions — client island */}
                  <QuoteLines
                    fixedSubtotalCents={fixedSubtotalCents}
                    optionalLines={optLines.map((line) => {
                      const lp = line.props;
                      return {
                        id: lp.id,
                        description: lp.description,
                        quantity: lp.quantity,
                        rateCents: lp.rate,
                      };
                    })}
                    discBps={p.discBps}
                    taxBps={p.taxBps}
                    depBps={p.depBps}
                    token={token}
                    changeAlreadyRequested={Boolean(p.changeRequestedAt)}
                  />
                </>
              )}

              {/* Terms snapshot — both formats, plain functional block */}
              {p.termsSnapshot && <TermsBlock text={p.termsSnapshot} />}
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
