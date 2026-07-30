// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InvoiceAuthorizationNote } from "./invoice-authorization";
import type { InvoiceAuthorization } from "@/lib/store/types";

const auth = (over: Partial<InvoiceAuthorization> = {}): InvoiceAuthorization => ({
  source: "estimate",
  signerName: "Dave Chen",
  signedAt: "2026-08-12T15:04:00.000Z",
  documentRef: "EST-1042",
  authorizedCents: 2_000_000,
  overage: null,
  ...over,
});

describe("InvoiceAuthorizationNote", () => {
  it("cites who authorised it and which document", () => {
    render(<InvoiceAuthorizationNote authorization={auth()} />);
    expect(screen.getByText(/Authorized by Dave Chen/)).toBeTruthy();
    expect(screen.getByText(/EST-1042/)).toBeTruthy();
  });

  it("says 'signed on site' for an on-glass signature", () => {
    render(<InvoiceAuthorizationNote authorization={auth({ source: "job", documentRef: "JOB-1007" })} />);
    expect(screen.getByText(/signed on site JOB-1007/)).toBeTruthy();
  });

  it("renders NOTHING when nothing was signed", () => {
    // No signed amount means no claim to make. Warning on every unsigned bill would train people
    // to dismiss the banner, and it only works while it stays rare.
    const { container } = render(<InvoiceAuthorizationNote authorization={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("warns with the exact unsigned amount when the bill exceeds what was signed", () => {
    // The $20,000 signed job that went out as $35,000.
    render(
      <InvoiceAuthorizationNote
        authorization={auth({
          overage: { authorizedCents: 2_000_000, invoicedCents: 3_500_000, excessCents: 1_500_000 },
        })}
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/\$15,000 of this bill was never signed for/)).toBeTruthy();
    expect(screen.getByText(/signed for \$20,000/)).toBeTruthy();
    expect(screen.getByText(/This invoice is \$35,000/)).toBeTruthy();
  });

  it("tells the shop what to DO, not just what is wrong", () => {
    // The fix is only available before sending — after the customer refuses, it is gone.
    render(
      <InvoiceAuthorizationNote
        authorization={auth({ overage: { authorizedCents: 100, invoicedCents: 200, excessCents: 100 } })}
      />,
    );
    expect(screen.getByText(/Get the extra work approved before you send this/)).toBeTruthy();
  });

  it("does not use the alert role when the bill is within the signed amount", () => {
    // A citation is information; only the overage is an alert. Announcing both to a screen reader
    // as alerts would make the real one indistinguishable.
    render(<InvoiceAuthorizationNote authorization={auth()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
