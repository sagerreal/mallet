import type { ReactNode } from "react";

/** The one card surface — renders the prototype `.card` (border + radius + soft
 *  shadow on the tokenised surface). Replaces ad-hoc bordered divs. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`.trim()}>{children}</div>;
}
