// @vitest-environment jsdom
/**
 * The office's view of a signature.
 *
 * What matters here is not layout — it is that the shop is shown the FROZEN record and never the
 * live quote, and that a hostile mark cannot execute in the office's browser.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignatureRecord } from "./signature-record";
import type { EstimateSignature } from "@/lib/store/types";

const sig = (over: Partial<EstimateSignature> = {}): EstimateSignature => ({
  signerName: "Dave Chen",
  signatureSvg: "M10,10 L40,30",
  signerIp: "203.0.113.9",
  signerUserAgent: "Mozilla/5.0 (iPhone)",
  signedAt: "2026-08-12T15:04:00.000Z",
  snapshot: {
    estimateNum: "EST-1042",
    totalCents: 2_000_000,
    depositCents: 50_000,
    chosenTier: null,
    authorizationText: "I authorize Bay Plumbing to perform the work described above for $20,000.00.",
    lines: [{ description: "Water heater", quantity: 1, rateCents: 2_000_000 }],
  },
  ...over,
});

describe("SignatureRecord", () => {
  it("names who signed and when", () => {
    render(<SignatureRecord signature={sig()} />);
    expect(screen.getByText("Dave Chen")).toBeTruthy();
    expect(screen.getByText(/Aug 12, 2026/)).toBeTruthy();
  });

  it("shows the amount from the SNAPSHOT, not a live total", () => {
    // The whole point. The live estimate can be edited after signing; this must keep reporting
    // what the customer actually agreed to. Read off the labelled row rather than by text, so a
    // matching figure elsewhere on the card cannot make this pass by accident.
    render(<SignatureRecord signature={sig()} />);
    const amount = screen.getByText("Amount signed for").nextElementSibling;
    expect(amount?.textContent).toBe("$20,000");

    // And the deposit is its own, different number — not the total repeated.
    expect(screen.getByText("Deposit").nextElementSibling?.textContent).toBe("$500");
  });

  it("quotes the authorisation sentence verbatim", () => {
    render(<SignatureRecord signature={sig()} />);
    expect(screen.getByText(/I authorize Bay Plumbing to perform the work/)).toBeTruthy();
  });

  it("renders the drawn mark as inert path data, never as HTML", () => {
    // signature_svg is authored by an unauthenticated stranger holding a link. Reaching the office
    // through dangerouslySetInnerHTML would be stored XSS; as a `d` attribute it cannot execute.
    const hostile = 'M0,0 L1,1"/><script>alert(1)</script><path d="';
    const { container } = render(<SignatureRecord signature={sig({ signatureSvg: hostile })} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("path")?.getAttribute("d")).toBe(hostile);
  });

  it("says so plainly when they signed by typing their name", () => {
    // Must not read as a failed drawing — a typed name is a signature.
    const { container } = render(<SignatureRecord signature={sig({ signatureSvg: null })} />);
    expect(screen.getByText("Signed by typing their name.")).toBeTruthy();
    expect(container.querySelector("path")).toBeNull();
  });

  it("shows the deposit only when one was taken", () => {
    render(<SignatureRecord signature={sig({ snapshot: { ...sig().snapshot, depositCents: 0 } })} />);
    expect(screen.queryByText("Deposit")).toBeNull();
  });

  it("lists the lines as they stood at signing", () => {
    render(<SignatureRecord signature={sig()} />);
    expect(screen.getByText(/What was on the quote when they signed/)).toBeTruthy();
    expect(screen.getByText("Water heater")).toBeTruthy();
  });

  it("omits IP and device rows when they were never captured", () => {
    render(<SignatureRecord signature={sig({ signerIp: null, signerUserAgent: null })} />);
    expect(screen.queryByText("Signed from")).toBeNull();
    expect(screen.queryByText("Device")).toBeNull();
  });
});
