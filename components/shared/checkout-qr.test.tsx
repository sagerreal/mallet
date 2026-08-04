// @vitest-environment jsdom
/**
 * components/shared/checkout-qr.test.tsx
 * CheckoutQr renders a URL as a scannable QR — qrcode's toDataURL lands in a
 * plain <img alt="Payment QR code">. A same-size placeholder holds the layout
 * while the encode is in flight, and an unencodable URL falls back to a
 * sentence pointing at the payment link (never a blank hole, never a throw).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { CheckoutQr } from "./checkout-qr";

const mockToDataURL = vi.fn<(url: string, opts?: unknown) => Promise<string>>();

vi.mock("qrcode", () => ({
  default: {
    toDataURL: (url: string, opts?: unknown) => mockToDataURL(url, opts),
  },
}));

const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_a1b2c3";

describe("CheckoutQr", () => {
  beforeEach(() => {
    mockToDataURL.mockReset();
  });

  it("renders an img with alt 'Payment QR code' whose src is the encoded data URL", async () => {
    mockToDataURL.mockResolvedValue("data:image/png;base64,QRTEST");
    render(<CheckoutQr url={CHECKOUT_URL} />);
    const img = (await screen.findByAltText("Payment QR code")) as HTMLImageElement;
    expect(img.src).toBe("data:image/png;base64,QRTEST");
    expect(mockToDataURL).toHaveBeenCalledTimes(1);
    expect(mockToDataURL.mock.calls[0]?.[0]).toBe(CHECKOUT_URL);
  });

  it("shows a placeholder (no img) while the encode is in flight", () => {
    mockToDataURL.mockReturnValue(new Promise(() => {})); // never resolves
    render(<CheckoutQr url={CHECKOUT_URL} />);
    expect(screen.queryByAltText("Payment QR code")).toBeNull();
  });

  it("falls back to a sentence naming the payment link when the encode fails", async () => {
    mockToDataURL.mockRejectedValue(new Error("bad input"));
    render(<CheckoutQr url={CHECKOUT_URL} />);
    await act(async () => {});
    expect(screen.queryByAltText("Payment QR code")).toBeNull();
    expect(screen.getByText(/use the payment link/i)).toBeTruthy();
  });
});
