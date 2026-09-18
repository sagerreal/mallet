import type { ReactNode, CSSProperties } from "react";

/** The one card surface — renders the prototype `.card` (border + radius + soft
 *  shadow on the tokenised surface). Replaces ad-hoc bordered divs. `style` is
 *  forwarded for per-instance layout (e.g. a flex column that stacks the body). */
export function Card({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`card ${className}`.trim()} style={style}>{children}</div>;
}
