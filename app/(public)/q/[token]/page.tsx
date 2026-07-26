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
    <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--line-2)" }}>
      <div className="muted" style={{ fontSize: "var(--type-xs)", marginBottom: "var(--space-1)" }}>
        Terms
      </div>
      <p
        style={{
          fontSize: "var(--type-sm)",
          lineHeight: 1.55,
          margin: "0",
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
          padding: "var(--space-6) var(--space-5)",
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
              fontSize: "var(--type-3xl)",
              marginBottom: "var(--space-4)",
              color: "var(--ink-3)",
            }}
          >
            &#x2014;
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--type-xl)",
              fontWeight: 700,
              marginBottom: "var(--space-3)",
            }}
          >
            This quote link is no longer valid
          </h1>
          <p className="muted" style={{ fontSize: "var(--type-base)", lineHeight: 1.6 }}>
            The link may have expired or been revoked. Contact the business
            directly for a fresh quote.
          </p>
          <p
            style={{
              fontSize: "var(--type-xs)",
              color: "var(--ink-3)",
              marginTop: "var(--space-8)",
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
        padding: "0 0 var(--space-10)",
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
            <div style={{ fontWeight: 800, fontSize: "var(--type-lg)" }}>{orgName}</div>
            <div style={{ fontSize: "var(--type-sm)", opacity: 0.8 }}>
              Quote {p.num}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="custbody">
          {/*
            A settled quote states its outcome ABOVE the quote — never INSTEAD of it.

            This block used to replace the entire body, so the instant a customer approved they lost
            sight of the lines, the total and the terms they had just agreed to. That is the one
            clear legal defect in this flow: ESIGN (15 U.S.C. § 7001(e)) lets an electronic record be
            denied legal effect if it cannot "be retained and accurately reproduced for later
            reference by all parties" — and here the approval IS the agreement. It is also plainly
            unhelpful: the customer has nothing to check the invoice against later.
          */}
          {isAccepted && (
            <>
              <div className="deltabanner" style={{ textAlign: "center" }}>
                Approved — thank you!
              </div>
              <p className="muted" style={{ textAlign: "center", margin: "var(--space-2) 0 var(--space-4)", fontSize: "var(--type-base)" }}>
                We&rsquo;ll be in touch to schedule the work. Below is what you approved &mdash;
                keep this link for your records.
              </p>
            </>
          )}
          {isDeclined && (
            <>
              <div className="reqcard" style={{ textAlign: "center" }}>
                You passed on this one — no hard feelings.
              </div>
              <p className="muted" style={{ textAlign: "center", margin: "var(--space-2) 0 var(--space-4)", fontSize: "var(--type-base)" }}>
                Reach out any time if you change your mind. Below is what we&rsquo;d quoted.
              </p>
            </>
          )}

          {!isDone && (
            <p style={{ fontSize: "var(--type-base)", lineHeight: 1.55, marginBottom: "var(--space-2)" }}>
              Here&rsquo;s your quote from <b>{orgName}</b>
              {customerFirstName ? `, ${customerFirstName}` : ""} — take a look.
            </p>
          )}

          {tierViews ? (
            /* Good/Better/Best: picker + selected tier's lines + totals + actions.
               Never reached on a settled quote — accept resolves the tiers into a single
               line set, so tierViewsFor returns null from then on. */
            <QuoteLines
              tiers={tierViews.tiers}
              recommendedTier={tierViews.recommendedTier}
              discBps={p.discBps}
              taxBps={p.taxBps}
              depBps={p.depBps}
              token={token}
              changeAlreadyRequested={Boolean(p.changeRequestedAt)}
              settled={isDone}
            />
          ) : (
            <>
              {/* Fixed lines. On an accepted quote these ARE the accepted set: accept rewrites the
                  stored lines to the fixed ones plus the chosen add-ons. */}
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
                settled={isDone}
              />
            </>
          )}

          {/* Terms snapshot — both formats, plain functional block. Kept on a settled quote: the
              terms are part of what was agreed to. */}
          {p.termsSnapshot && <TermsBlock text={p.termsSnapshot} />}

          {/* Footer */}
          <p className="muted" style={{ fontSize: "var(--type-xs)", textAlign: "center", marginTop: "var(--space-4)" }}>
            Powered by Mallet &mdash; licensed &amp; insured
          </p>
        </div>
      </div>

      {/* Valid-days notice below the card */}
      {p.validDays && !isDone && (
        <p
          className="muted"
          style={{
            marginTop: "var(--space-3)",
            fontSize: "var(--type-sm)",
            textAlign: "center",
            maxWidth: 320,
            padding: "0 var(--space-4)",
          }}
        >
          This quote is valid for {p.validDays} days from the date it was sent.
        </p>
      )}
    </main>
  );
}
