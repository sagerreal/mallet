// @vitest-environment jsdom
/**
 * The document-wording read that serves BOTH shells. The close-out document (field) and the
 * customer preview (office) render the invoice footer, and the change-order sign screen
 * (field) renders the agreement line — v1.settings.get is ownerOrOffice, so the field layout
 * needs this anyRole read or a technician's copy of those sentences is stuck at the standard
 * wording while the customer's own page carries the shop's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { DocumentWordingHydrator } from "./document-wording-hydrator";

const setDocWording = vi.fn();
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { setDocWording: typeof setDocWording }) => unknown) =>
    sel({ setDocWording }),
}));

const wordingQuery = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      settings: {
        documentWording: { useQuery: () => wordingQuery() },
      },
    },
  },
}));

describe("DocumentWordingHydrator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lands the overrides on the store", () => {
    wordingQuery.mockReturnValue({
      data: { invoiceFooter: "1-year warranty.", changeOrderAgreement: null },
      isError: false,
      error: null,
    });
    render(<DocumentWordingHydrator />);
    expect(setDocWording).toHaveBeenCalledWith({
      invoiceFooter: "1-year warranty.",
      changeOrderAgreement: null,
    });
  });

  it("writes NOTHING while the read is in flight", () => {
    wordingQuery.mockReturnValue({ data: undefined, isError: false, error: null });
    render(<DocumentWordingHydrator />);
    expect(setDocWording).not.toHaveBeenCalled();
  });

  /**
   * A failed read writes nothing — the store stays null and every surface renders the
   * STANDARD sentences, exactly what an untouched shop shows. Never a blank line.
   */
  it("writes NOTHING on a failed read", () => {
    wordingQuery.mockReturnValue({ data: undefined, isError: true, error: new Error("500") });
    expect(() => render(<DocumentWordingHydrator />)).not.toThrow();
    expect(setDocWording).not.toHaveBeenCalled();
  });
});
