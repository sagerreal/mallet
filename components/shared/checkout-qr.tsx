"use client";

/**
 * components/shared/checkout-qr.tsx
 * A URL rendered as a scannable QR code — the close-out card step presents a
 * Stripe Checkout link this way at the door. Data-URL only (qrcode's
 * toDataURL), no canvas mounting: the async encode lands in state and renders
 * as a plain <img>, with a same-size placeholder while it draws so the sheet
 * never jumps.
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";

const DEFAULT_SIZE = 184;

interface CheckoutQrProps {
  url: string;
  /** Rendered square edge, px. */
  size?: number;
}

type QrState =
  | { kind: "loading" }
  | { kind: "ready"; dataUrl: string }
  | { kind: "failed" };

export function CheckoutQr({ url, size = DEFAULT_SIZE }: CheckoutQrProps) {
  const [state, setState] = useState<QrState>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    QRCode.toDataURL(url, { margin: 1, width: size })
      .then((dataUrl) => {
        if (alive) setState({ kind: "ready", dataUrl });
      })
      .catch(() => {
        // qrcode only rejects on unencodable input; the caller always renders the
        // raw link beside this component, so name that fallback instead of throwing.
        if (alive) setState({ kind: "failed" });
      });
    return () => {
      alive = false;
    };
  }, [url, size]);

  if (state.kind === "failed") {
    return (
      <p className="muted" style={{ fontSize: "var(--type-sm)", margin: 0 }}>
        Couldn&rsquo;t draw the QR code — use the payment link instead.
      </p>
    );
  }

  if (state.kind === "loading") {
    return (
      <div
        aria-hidden
        style={{
          width: size,
          height: size,
          margin: "0 auto",
          borderRadius: "var(--radius-sm)",
          background: "var(--card)",
        }}
      />
    );
  }

  return (
    <img
      src={state.dataUrl}
      alt="Payment QR code"
      width={size}
      height={size}
      style={{ display: "block", margin: "0 auto", borderRadius: "var(--radius-sm)" }}
    />
  );
}
