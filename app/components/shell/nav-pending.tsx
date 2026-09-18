"use client";

/**
 * components/shell/nav-pending.tsx
 * The sidebar's "this tap landed" marker.
 *
 * A tap that crosses shells — office and field are separate route trees — can take a beat while
 * the next tree loads, and the item it was aimed at showed nothing at all in the meantime. A row
 * that answers a press with silence reads as a dead control, and gets pressed again.
 *
 * `useLinkStatus` reports the enclosing <Link>'s navigation, so this has to be a CHILD of that
 * link: the component that renders the Link cannot call the hook for it. That is also why the
 * pending look is expressed in the stylesheet off `.navitem:has(.navpend)` rather than as a
 * className here — the marker is inside the row it has to dress.
 */

import { useLinkStatus } from "next/link";

export function NavPending() {
  const { pending } = useLinkStatus();
  // Decoration: the row already names itself through its own link text.
  return pending ? <span className="navpend" aria-hidden="true" /> : null;
}
