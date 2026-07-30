"use client";

import type { EstimateSignature } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";

/**
 * The signature, as the shop needs to be able to produce it.
 *
 * This is the whole point of capturing one. A shop chasing an unpaid balance has to answer "prove
 * they agreed to that" — and until this existed the answer was a SQL query, which a plumbing shop
 * owner cannot run and which is not a record produced in the ordinary course of business.
 *
 * Everything here is read from the frozen SNAPSHOT, never from the live estimate. The live row can
 * be edited after signing; the snapshot is what the customer actually saw. Showing today's total
 * next to a signature from August would be the exact discrepancy the other side points at.
 *
 * The drawn mark renders as an SVG <path d=…>, NOT via dangerouslySetInnerHTML. The path data was
 * authored by an unauthenticated stranger holding a link, and passing that string to an HTML
 * parser would be stored XSS aimed straight at the office. As a `d` attribute it is inert: the
 * worst a hostile value can do is draw a bad squiggle.
 */

export interface SignatureRecordProps {
  readonly signature: EstimateSignature;
}

/**
 * The signing time, with its zone named.
 *
 * The zone is not decoration. "Aug 12, 2026, 8:04 AM" on a document meant to settle a dispute is
 * ambiguous the moment anyone reads it somewhere else, and a deadline argument can turn on which
 * day a signature landed. Rendered in the reader's local zone — which is the shop's — and labelled
 * so the reader knows which zone that is.
 */
const stamp = (iso: string): string =>
  // Spelled out field by field rather than with dateStyle/timeStyle: Intl forbids combining those
  // shorthands with timeZoneName, and Node throws on it where browsers quietly cope.
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

export function SignatureRecord({ signature: s }: SignatureRecordProps) {
  const snap = s.snapshot;

  return (
    <section
      style={{
        border: "1.5px solid var(--line)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-4)",
        marginTop: "var(--space-4)",
        background: "var(--card)",
      }}
    >
      <h3
        style={{
          margin: 0,
          marginBottom: "var(--space-3)",
          fontSize: "var(--type-sm)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--ink-2)",
        }}
      >
        Signed by the customer
      </h3>

      <div style={{ fontSize: "var(--type-lg)", fontWeight: 700, color: "var(--ink)" }}>
        {s.signerName}
      </div>
      <div style={{ fontSize: "var(--type-base)", color: "var(--ink-2)", marginTop: "var(--space-1)" }}>
        {stamp(s.signedAt)}
      </div>

      {s.signatureSvg && (
        <svg
          viewBox="0 0 600 180"
          role="img"
          aria-label={`Signature drawn by ${s.signerName}`}
          style={{
            width: "100%",
            maxWidth: "320px",
            height: "auto",
            aspectRatio: "600 / 180",
            display: "block",
            marginTop: "var(--space-3)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg)",
          }}
        >
          {/* Inert by construction — path data cannot execute. See the note above. */}
          <path
            d={s.signatureSvg}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {!s.signatureSvg && (
        <div style={{ fontSize: "var(--type-sm)", color: "var(--ink-3)", marginTop: "var(--space-2)" }}>
          {/* Said plainly so nobody reads the absent drawing as a failure. A typed name is a
              signature — see modules/quoting/domain/signature.ts. */}
          Signed by typing their name.
        </div>
      )}

      {/* What they agreed to, verbatim. The sentence is the thing under dispute, so it is quoted
          rather than paraphrased or rebuilt from the current template. */}
      <blockquote
        style={{
          margin: "var(--space-4) 0 0",
          paddingLeft: "var(--space-3)",
          borderLeft: "3px solid var(--line)",
          fontSize: "var(--type-base)",
          lineHeight: 1.55,
          color: "var(--ink)",
        }}
      >
        {snap.authorizationText}
      </blockquote>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "var(--space-1) var(--space-4)",
          margin: "var(--space-4) 0 0",
          fontSize: "var(--type-sm)",
        }}
      >
        <dt style={{ color: "var(--ink-2)" }}>Amount signed for</dt>
        <dd style={{ margin: 0, fontWeight: 700, color: "var(--ink)" }}>{fmt$(snap.totalCents / 100)}</dd>

        {snap.depositCents > 0 && (
          <>
            <dt style={{ color: "var(--ink-2)" }}>Deposit</dt>
            <dd style={{ margin: 0, color: "var(--ink)" }}>{fmt$(snap.depositCents / 100)}</dd>
          </>
        )}

        <dt style={{ color: "var(--ink-2)" }}>Quote</dt>
        <dd style={{ margin: 0, color: "var(--ink)" }}>{snap.estimateNum}</dd>

        {snap.chosenTier && (
          <>
            <dt style={{ color: "var(--ink-2)" }}>Option chosen</dt>
            <dd style={{ margin: 0, color: "var(--ink)", textTransform: "capitalize" }}>{snap.chosenTier}</dd>
          </>
        )}

        {/* IP and device are corroboration, not identity. Kept in the record because they are what
            a shop is asked for when a signature is challenged, but shown last and quietly. */}
        {s.signerIp && (
          <>
            <dt style={{ color: "var(--ink-2)" }}>Signed from</dt>
            <dd style={{ margin: 0, color: "var(--ink-2)" }}>{s.signerIp}</dd>
          </>
        )}
        {s.signerUserAgent && (
          <>
            <dt style={{ color: "var(--ink-2)" }}>Device</dt>
            <dd style={{ margin: 0, color: "var(--ink-2)", wordBreak: "break-word" }}>{s.signerUserAgent}</dd>
          </>
        )}
      </dl>

      {/* The frozen line set. A customer who later says a service was promised is answered by what
          is, and is not, in this list. */}
      <div style={{ marginTop: "var(--space-4)" }}>
        <div style={{ fontSize: "var(--type-sm)", color: "var(--ink-2)", marginBottom: "var(--space-2)" }}>
          What was on the quote when they signed
        </div>
        {snap.lines.map((l, i) => (
          <div
            key={`${l.description}-${i}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "var(--space-3)",
              padding: "var(--space-1) 0",
              fontSize: "var(--type-base)",
              borderTop: i === 0 ? "none" : "1px solid var(--line)",
            }}
          >
            <span style={{ color: "var(--ink)" }}>
              {l.description}
              {l.quantity !== 1 && <span style={{ color: "var(--ink-3)" }}> × {l.quantity}</span>}
            </span>
            <span style={{ color: "var(--ink)", whiteSpace: "nowrap" }}>
              {fmt$((l.rateCents * l.quantity) / 100)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
