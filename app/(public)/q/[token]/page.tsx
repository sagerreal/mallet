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
import { fmt$ } from "@/lib/format";
import { QuoteLines } from "./QuoteLines";
import { tierViewsFor } from "./tier-view";
import { groupBySection } from "./section-groups";
import {
  ProposalCover,
  ProposalPage,
  ProposalShell,
  docHasCoverSheet,
  docPages,
  snapshotSheetStyle,
} from "./ProposalDocument";
import { payableDepositCents } from "@/modules/quoting/domain/deposit-payable";

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

  const { estimate, orgName, customerFirstName, chargesEnabled } = view;
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
  // Components never reach the customer: a component is a part inside an assembly, and the
  // parent line the customer reads already carries its money. Rendering them would show the
  // shop's own build-up on the customer's quote AND read as extra charges beside a total that
  // does not contain them. Same predicate the domain's totals use (Estimate.contributesMoney).
  const quotedLines = p.lines.filter((l) => !l.props.parentLineId);
  const fixedLines = quotedLines.filter((l) => !l.props.isOptional);
  // The customer's copy, grouped under the headings the shop wrote on the quote.
  const { ungrouped: ungroupedLines, groups: sectionGroups } = groupBySection(estimate, fixedLines);
  const optLines = quotedLines.filter((l) => l.props.isOptional);
  const fixedSubtotalCents = estimate.subtotal();
  // The SECOND base: what the rate is charged on. Non-taxable lines stay in the subtotal above.
  const fixedTaxableCents = estimate.taxableBase();
  // 'total' = the proposal format: scope prose + ONE price at the bottom. Per-line amounts hide;
  // optional add-on prices always show (adding one changes the total, so its price must be
  // visible), and the totals block is untouched.
  const showLineAmounts = estimate.priceDisplay() !== "total";
  // The designed proposal pages frozen at draft time — null on a plain quote. Cover renders
  // when present; a non-cover page with an empty body hides itself (the shop hasn't written
  // it yet); thanks renders after the terms so the document ends on the shop's voice.
  const presentation = p.presentationSnapshot ?? null;
  const presentationCover = presentation?.pages.find((page) => page.key === "cover") ?? null;
  // Which pages render, and in what order — decided once, by the same rules the office's
  // preview follows. A page renders when it has words OR pictures: filtering on prose alone hid
  // a photos page whose whole content is the photos, which is most of them.
  const presentationBody = presentation ? docPages(presentation) : [];
  // Short-lived links minted server-side — the visitor has no session, so there is no path by
  // which the browser could sign these for itself. See signProposalPhotos.
  const photoUrls = view.photoUrls ?? new Map<string, string>();
  const presentationThanks =
    presentation?.pages.find((page) => page.key === "thanks" && page.body.trim().length > 0) ?? null;

  // The deposit a RETURNING customer can still pay. 0 — so no button renders at all — whenever
  // paying it is impossible: an unaccepted quote, nothing left owed, a shop that can't take cards,
  // or an amount under the card minimum the server would refuse. ONE predicate shared with that
  // server guard and with QuoteActions' post-approval branch, so a button can never be offered for
  // something the checkout would reject. Amounts come from the domain's own depositDue().
  const payableDeposit = payableDepositCents({
    accepted: isAccepted,
    depositDueCents: estimate.depositDue(),
    depositPaidCents: p.depPaid,
    cardPaymentAvailable: chargesEnabled,
  });

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
      {/* The proposal, as paper — the same sheets the office previewed, carrying the shop's
          own look. A quote with no presentation stays the plain card below, which is the
          default and deliberately not a document. */}
      {presentation && (
        <div className="sheets" style={snapshotSheetStyle(presentation)}>
          {docHasCoverSheet(presentation) && (
            <article className="docsheet" aria-label="Cover page">
              <ProposalCover
                page={presentationCover}
                title={p.title?.trim() || `Quote ${p.num}`}
                customerFirstName={customerFirstName}
                orgName={orgName}
                quoteNum={p.num}
                meta={presentation.meta}
              />
              {presentationBody.map((page) => (
                <ProposalPage key={page.key} page={page} urls={photoUrls} />
              ))}
              <footer className="docsheet-foot">
                <span>{orgName}</span>
                <span>Page 1</span>
              </footer>
            </article>
          )}
        </div>
      )}

      {/* The quote itself.
          On a plain quote this is the 520px card it has always been. On a proposal it is the
          estimate SHEET — in Simple that sheet also carries the cover and the photos, because
          Simple is one page. Its machinery (add-on toggles, approve, sign, pay) is identical
          either way: a document is not a reason to rebuild the part that takes the money. */}
      <ProposalShell presentation={presentation} orgName={orgName}>
        {presentation && !docHasCoverSheet(presentation) && (
          <>
            <ProposalCover
              page={presentationCover}
              title={p.title?.trim() || `Quote ${p.num}`}
              customerFirstName={customerFirstName}
              orgName={orgName}
              quoteNum={p.num}
              meta={presentation.meta}
            />
            {presentationBody.map((page) => (
              <ProposalPage key={page.key} page={page} urls={photoUrls} />
            ))}
          </>
        )}
      <div
        style={{
          width: "100%",
          background: "var(--card)",
          overflow: "hidden",
        }}
      >
        {/* Branded header — a plain quote only. On a proposal the COVER already names the shop
            and the quote, and a second brand band inside the document reads as another card. */}
        {!presentation && (
        <div className="custhead">
          <div className="custlogo">{initials}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: "var(--type-lg)" }}>{orgName}</div>
            <div style={{ fontSize: "var(--type-sm)", opacity: 0.8 }}>
              Quote {p.num}
            </div>
          </div>
        </div>
        )}

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
              showLineAmounts={showLineAmounts}
              discBps={p.discBps}
              taxBps={p.taxBps}
              depBps={p.depBps}
              token={token}
              orgName={orgName}
              changeAlreadyRequested={Boolean(p.changeRequestedAt)}
              settled={isDone}
              payableDepositCents={payableDeposit}
              cardPaymentAvailable={chargesEnabled}
            />
          ) : (
            <>
              {/* Fixed lines. On an accepted quote these ARE the accepted set: accept rewrites the
                  stored lines to the fixed ones plus the chosen add-ons. */}
              {ungroupedLines.map((line) => {
                const lp = line.props;
                return (
                  <LineRow
                    key={lp.id}
                    description={lp.description}
                    quantity={lp.quantity}
                    rateCents={lp.rate}
                    taxable={lp.taxable}
                    showTaxMark={p.taxBps > 0}
                    scope={lp.scope}
                    showAmount={showLineAmounts}
                  />
                );
              })}
              {sectionGroups.map((group) => (
                <div key={group.name}>
                  <div className="custsection">
                    <span>{group.name}</span>
                    {/* No group subtotal under 'one price' — the whole point of that format is
                        that the customer reads a single number. */}
                    {/* fmt$ like the rows beneath it — a heading reading $240.00 beside a line
                        reading $240 is two formatters arguing on the customer's document. */}
                    {showLineAmounts && <b>{fmt$(group.totalCents / 100)}</b>}
                  </div>
                  {group.lines.map((line) => {
                    const lp = line.props;
                    return (
                      <LineRow
                        key={lp.id}
                        description={lp.description}
                        quantity={lp.quantity}
                        rateCents={lp.rate}
                        taxable={lp.taxable}
                        showTaxMark={p.taxBps > 0}
                        scope={lp.scope}
                        showAmount={showLineAmounts}
                      />
                    );
                  })}
                </div>
              ))}

              {/* Optional add-on toggles + live totals + actions — client island */}
              <QuoteLines
                fixedSubtotalCents={fixedSubtotalCents}
                fixedTaxableCents={fixedTaxableCents}
                showLineAmounts={showLineAmounts}
                optionalLines={optLines.map((line) => {
                  const lp = line.props;
                  return {
                    id: lp.id,
                    description: lp.description,
                    quantity: lp.quantity,
                    rateCents: lp.rate,
                    taxable: lp.taxable,
                  };
                })}
                discBps={p.discBps}
                taxBps={p.taxBps}
                depBps={p.depBps}
                token={token}
                orgName={orgName}
                changeAlreadyRequested={Boolean(p.changeRequestedAt)}
                settled={isDone}
                payableDepositCents={payableDeposit}
                cardPaymentAvailable={chargesEnabled}
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
      </ProposalShell>

      {presentationThanks && (
        /* Closing page — the document ends on the shop's voice. */
        <div
          style={{
            width: "100%",
            maxWidth: 520,
            background: "var(--accent)",
            color: "var(--pri-fg)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-6)",
            marginTop: "var(--space-4)",
            textAlign: "center",
            boxShadow: "var(--shadow)",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: "var(--type-lg)", marginBottom: "var(--space-2)" }}>
            {presentationThanks.title.trim() || "Thank you"}
          </div>
          <p style={{ whiteSpace: "pre-wrap", fontSize: "var(--type-sm)", opacity: 0.85, margin: "0 auto", maxWidth: "44ch" }}>
            {presentationThanks.body}
          </p>
        </div>
      )}

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
