/**
 * app/(public)/i/[token]/PrintInvoiceButton.tsx
 *
 * The second interaction on the public invoice page: print it, or save it as a PDF.
 *
 * A client island for the same reason PayInvoiceButton is one — the page itself is a server
 * component and `window.print()` is a browser call. It is deliberately the WHOLE implementation:
 * the browser's own print dialog is where "Save as PDF" lives on every desktop OS and on iOS
 * (Share → print preview → save), so there is no server-side renderer to build and nothing to
 * download that could go stale against the record.
 *
 * WHAT MAKES THE OUTPUT A DOCUMENT rather than a screenshot of a web page lives in
 * app/prototype.css under `@media print`: this button, the Pay button and the "Powered by Mallet"
 * footer are all `.noprint`, the card loses its border/shadow/rounding, everything resolves to
 * black on white, and `@page { margin: 0 }` stops the browser printing the URL — which contains
 * the invoice's 256-bit bearer token — into a page header.
 */

"use client";

import { Button } from "@/components/ui/button";

export function PrintInvoiceButton() {
  return (
    <Button variant="quiet" size="sm" onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  );
}
