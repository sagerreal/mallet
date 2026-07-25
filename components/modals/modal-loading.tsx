/**
 * components/modals/modal-loading.tsx
 * What a modal shows while its body is still arriving.
 *
 * Every modal body is loaded with next/dynamic({ ssr: false }) so the ~261KB modal chunk stays out
 * of the first-load bundle. That is worth keeping — but dynamic() renders NOTHING until the chunk
 * lands, and the shell paints immediately, so opening a modal on a cold chunk showed an empty card
 * collapsed to the height of its ✕ button before snapping to full size. A sliver, then a jump.
 *
 * So: a body of a believable size, with the house shimmer, sized to the modal it stands in for.
 * The panel opens at roughly its final height and settles rather than jumping.
 *
 * `aria-busy` + role="status" means assistive tech says "Loading" instead of announcing an empty
 * dialog — the shell has already moved focus in by this point.
 */

/** Roughly how tall the real body is, so the panel does not resize under the reader. */
export type ModalBodySize = "sm" | "md" | "lg";

const ROWS: Record<ModalBodySize, number> = { sm: 3, md: 6, lg: 9 };

export function ModalLoading({ size = "md" }: { size?: ModalBodySize }) {
  return (
    <div role="status" aria-busy="true" style={{ padding: "var(--space-2) 0" }}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: ROWS[size] }).map((_, i) => (
        <div key={i} className="sk-row" aria-hidden="true">
          <div className="sk" style={{ width: i % 3 === 0 ? "38%" : "72%", height: 14 }} />
        </div>
      ))}
    </div>
  );
}
