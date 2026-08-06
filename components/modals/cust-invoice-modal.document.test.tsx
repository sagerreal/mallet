// @vitest-environment jsdom
/**
 * components/modals/cust-invoice-modal.document.test.tsx
 *
 * "Preview as customer" must show what the customer actually receives.
 *
 * The office preview and `/i/<token>` render the same <InvoiceDocument>, so the facts that make it
 * a document of record — the shop's contact block, the customer's name, the service address, the
 * invoice and service dates — have to reach BOTH or the preview is a lie about the bill. The one
 * thing this surface must NOT repeat is the shop's NAME: `CustHead` prints it an inch above.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CustInvoiceModalContent } from "./cust-invoice-modal";
import type { BusinessIdentity, Brand, Invoice } from "@/lib/store/types";

const noop = vi.fn();
let mockInvoices: Invoice[] = [];
let mockBusiness: BusinessIdentity | null = null;

const brand: Brand = {
  site: "riveraplumbing.com",
  name: "Rivera Plumbing",
  initials: "RP",
  color: "#1a5",
  tagline: "Licensed & insured",
};

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "cust-invoice", params: { invoiceId: "inv-1" } }),
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      invoices: mockInvoices,
      leads: [],
      jobs: [],
      brand,
      business: mockBusiness,
      recordPayment: noop,
      adoptInvoice: noop,
      updateLead: noop,
    }),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      invoicing: {
        get: { useQuery: () => ({ data: undefined, isError: false }) },
      },
    },
  },
}));

const IDENTITY: BusinessIdentity = {
  name: "Rivera Plumbing",
  address: "200 Ray St, Pleasanton, CA 94566",
  phone: "(925) 555-0100",
  email: "billing@rivera.test",
  site: "riveraplumbing.com",
  license: "C36-1029384",
};

const inv = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    num: "INV-810",
    jobId: null,
    leadId: "lead-1",
    cust: "Priya Novak",
    phone: "",
    title: "Hydro-jetting — main sewer",
    lines: [{ d: "Hydro-jetting", q: 1, r: 685 }],
    total: 685,
    depPaid: 0,
    payments: [],
    status: "sent",
    termsDays: 0,
    age: 0,
    archived: false,
    origin: "db",
    createdAt: "2026-08-05T18:00:00.000Z",
    ...over,
  }) as Invoice;

describe("CustInvoiceModalContent — the preview is the document", () => {
  beforeEach(() => {
    mockInvoices = [];
    mockBusiness = null;
  });

  it("prints the shop's contact block, the customer, the address and both dates", () => {
    mockBusiness = IDENTITY;
    mockInvoices = [
      inv({
        serviceAddress: "18 Aspen Ct, Dublin, CA 94568",
        serviceAt: "2026-08-03T16:20:00.000Z",
      }),
    ];
    render(<CustInvoiceModalContent />);

    expect(screen.getByText("200 Ray St, Pleasanton, CA 94566")).toBeTruthy();
    expect(screen.getByText("(925) 555-0100")).toBeTruthy();
    expect(screen.getByText("Lic. C36-1029384")).toBeTruthy();

    expect(screen.getByText("Priya Novak")).toBeTruthy();
    expect(screen.getByText("18 Aspen Ct, Dublin, CA 94568")).toBeTruthy();
    expect(screen.getByText(/Invoiced Aug 5, 2026/)).toBeTruthy();
    expect(screen.getByText(/Service Aug 3, 2026/)).toBeTruthy();
  });

  it("names the shop ONCE — CustHead already does it", () => {
    mockBusiness = IDENTITY;
    mockInvoices = [inv()];
    render(<CustInvoiceModalContent />);
    // Two copies of the name an inch apart is what `documentContact` (no `name` key) prevents.
    // The preview banner mentions the shop too, so this counts the standalone headings only.
    const headings = screen.getAllByRole("heading", { name: "Rivera Plumbing" });
    expect(headings).toHaveLength(1);
  });

  it("omits the identity block until the shop's details have hydrated", () => {
    mockInvoices = [inv()];
    render(<CustInvoiceModalContent />);
    expect(screen.queryByText(/^Lic\./)).toBeNull();
    expect(screen.queryByText("200 Ray St, Pleasanton, CA 94566")).toBeNull();
  });

  it("omits a service address and a service date it does not have", () => {
    mockBusiness = IDENTITY;
    mockInvoices = [inv()];
    render(<CustInvoiceModalContent />);
    expect(screen.getByText("Bill to")).toBeTruthy();
    expect(screen.queryByText("Service address")).toBeNull();
    expect(screen.queryByText(/Service Aug/)).toBeNull();
  });
});
