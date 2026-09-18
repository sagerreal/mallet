/**
 * The proposal, as the customer reads it — the same sheets the office previewed.
 *
 * Server components: everything here is frozen snapshot content, so nothing fetches and nothing
 * is interactive. The parts of the quote the customer ACTS on — the add-on toggles, approve,
 * sign, pay — stay in the client island below, unchanged. A document is not a reason to rebuild
 * the machinery that takes the money.
 *
 * The layout rules live in the composer's doc-design so the office and the customer reach the
 * same answer from the same snapshot; a second implementation would be a second document.
 */

import type { CSSProperties } from "react";
import { docFontStack } from "@/lib/doc-fonts";
import { ProposalPhotos } from "./ProposalPhotos";

/** The snapshot shape as it reaches this page. Structural — no import from the office's state. */
export interface ProposalSnapshot {
  readonly templateName: string;
  readonly pages: readonly {
    readonly key: string;
    readonly title: string;
    readonly body: string;
    readonly photos?: readonly {
      readonly id: string;
      readonly key: string;
      readonly beforeKey?: string | null;
      readonly caption?: string | null;
    }[];
  }[];
  readonly mode?: "simple" | "full";
  readonly design?: {
    readonly font?: string;
    readonly size?: number;
    readonly accent?: string;
    readonly bold?: boolean;
    readonly italic?: boolean;
  };
  readonly meta?: {
    readonly estimator?: string;
    readonly estimatorRole?: string;
    readonly contact?: string;
    readonly estNumber?: string;
    readonly validity?: string;
    readonly date?: string;
  };
}


/**
 * The shop's look as custom properties the sheet's own type scale reads.
 *
 * The accent is the one value that comes from stored data and lands in a style attribute, so
 * the domain validates it as `#rrggbb` on every read-back — see PresentationSnapshot. It is
 * re-checked here anyway: this is the render that would carry a bad one onto a public page.
 */
export function snapshotSheetStyle(snapshot: ProposalSnapshot): CSSProperties {
  const design = snapshot.design ?? {};
  const stack = docFontStack(design.font);
  const accent = design.accent && /^#[0-9a-fA-F]{6}$/.test(design.accent) ? design.accent : null;
  return {
    ...(stack ? { "--doc-font": stack } : {}),
    "--doc-size": `${design.size ?? 14}px`,
    ...(accent ? { "--doc-accent": accent } : {}),
    "--doc-head-weight": design.bold === false ? 650 : 800,
    "--doc-sub-style": design.italic ? "italic" : "normal",
  } as CSSProperties;
}

/** Does this document lead with a cover SHEET? Simple keeps the cover on the estimate sheet. */
export function docHasCoverSheet(snapshot: ProposalSnapshot): boolean {
  return (snapshot.mode ?? "simple") === "full";
}

/**
 * The pages that render on the cover sheet in Full, and the photos alone in Simple.
 *
 * Simple is one page — the work, the price, the signature and the terms — but a shop sending
 * one still wants the before-and-afters on it. Mode decides what is SHOWN; the snapshot still
 * carries everything that was written.
 */
export function docPages(snapshot: ProposalSnapshot): ProposalSnapshot["pages"] {
  const renders = (page: ProposalSnapshot["pages"][number]) =>
    page.body.trim().length > 0 || (page.photos?.length ?? 0) > 0;
  if ((snapshot.mode ?? "simple") === "simple") {
    return snapshot.pages.filter((page) => page.key === "photos" && renders(page));
  }
  // Warranty is NOT here — it renders after the estimate, beside the terms, in both modes:
  // what is promised belongs with the page being signed. See docWarranty below.
  const order = ["letter", "about", "photos", "process", "reviews"];
  return order
    .map((key) => snapshot.pages.find((page) => page.key === key))
    .filter((page): page is ProposalSnapshot["pages"][number] => Boolean(page && renders(page)));
}

/** The warranty, when written — rendered after the estimate, beside the terms, both modes. */
export function docWarranty(snapshot: ProposalSnapshot): ProposalSnapshot["pages"][number] | null {
  const page = snapshot.pages.find((x) => x.key === "warranty");
  return page && page.body.trim().length > 0 ? page : null;
}

export function ProposalCover({
  page,
  title,
  customerFirstName,
  orgName,
  quoteNum,
  meta,
}: {
  page: ProposalSnapshot["pages"][number] | null;
  title: string;
  customerFirstName: string;
  orgName: string;
  quoteNum: string;
  meta?: ProposalSnapshot["meta"];
}) {
  // The cover page's stored `title` is the "what this covers" line UNDER the h2 — the same
  // meaning the office's CoverHead renders and its editor teaches. The kicker is fixed: this
  // document is a proposal from this shop, and no page field renames that.
  return (
    <header className="doccover">
      <div className="kick">Proposal{orgName ? ` · ${orgName}` : ""}</div>
      <h2>{title}</h2>
      {page?.title.trim() ? <p className="sub">{page.title}</p> : null}
      <div className="docmeta">
        <MetaBlock label="Prepared for" value={customerFirstName} sub={meta?.date} />
        <MetaBlock label="From" value={meta?.estimator ?? orgName} sub={meta?.contact ?? meta?.estimatorRole} />
        <MetaBlock label="Estimate" value={meta?.estNumber ?? quoteNum} sub={meta?.validity} />
      </div>
      {page?.body.trim() ? <p className="docbody">{page.body}</p> : null}
    </header>
  );
}

export function ProposalPage({
  page,
  urls,
}: {
  page: ProposalSnapshot["pages"][number];
  urls: ReadonlyMap<string, string>;
}) {
  return (
    <section className="docsec">
      <div className="docsec-inner">
        <div className="dock">{page.title.trim() || page.key}</div>
        {page.body.trim() ? <p className="docbody">{page.body}</p> : null}
        <ProposalPhotos photos={page.photos ?? []} urls={urls} />
      </div>
    </section>
  );
}

function MetaBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="blk">
      <div className="k">{label}</div>
      <div className="v">
        <b>{value}</b>
        {sub ? <div>{sub}</div> : null}
      </div>
    </div>
  );
}

/**
 * What the quote sits inside.
 *
 * A plain quote keeps the card it has always been — 520px, rounded, deliberately not a
 * document. A proposal gets the estimate SHEET, carrying the shop's own look. One component
 * so the page does not branch on `presentation` in four places and get one of them wrong.
 */
export function ProposalShell({
  presentation,
  orgName,
  children,
}: {
  presentation: ProposalSnapshot | null;
  /** Printed in the sheet's footer, the way a page of a real proposal is signed. */
  orgName: string;
  children: React.ReactNode;
}) {
  if (!presentation) {
    return (
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
        {children}
      </div>
    );
  }
  return (
    <div className="sheets" style={snapshotSheetStyle(presentation)}>
      <article className="docsheet" aria-label="The estimate">
        {children}
        <footer className="docsheet-foot">
          <span>{orgName}</span>
          <span>Page {docHasCoverSheet(presentation) ? 2 : 1}</span>
        </footer>
      </article>
    </div>
  );
}
