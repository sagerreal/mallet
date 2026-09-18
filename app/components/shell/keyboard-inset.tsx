"use client";

/**
 * components/shell/keyboard-inset.tsx
 * Mounts the keyboard-inset publisher for the whole app.
 *
 * Every fixed bottom composer has the same iOS problem — the Ask screen and the Messages thread
 * both pin themselves above the tab bar and both were covered by the keyboard until iOS scrolled.
 * One mount, one `--kb` custom property, and each surface positions against it with `max()`.
 *
 * Renders nothing. See lib/mobile/use-keyboard-inset.ts for why the viewport meta is not enough.
 */

import { useKeyboardInset } from "@/lib/mobile/use-keyboard-inset";

export function KeyboardInset() {
  useKeyboardInset();
  return null;
}
