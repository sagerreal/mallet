/**
 * app/(public)/layout.tsx
 *
 * Minimal root layout for public (unauthenticated) routes.
 * No office sidebar, no auth guard, no app chrome.
 * Fonts + design tokens come from globals.css / prototype.css loaded in the root
 * layout — this group shares the same <html>/<body> from app/layout.tsx.
 */
import type { ReactNode } from "react";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
