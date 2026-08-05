// @vitest-environment jsdom
/**
 * components/modals/close-out-document.test.tsx
 *
 * The customer's copy at the door. What must hold:
 *   - the itemised document expands IN-FLOW, and only when there are rates to show;
 *   - a prices-hidden shop gets no Show button and STILL gets the Send button;
 *   - the send verb follows the balance (invoice while owed, receipt once settled);
 *   - a failed send says so, in place, with a retry — never a silent "Sent".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Invoice } from "@/lib/store/types";

const sendMock = vi.fn<(invoiceId: string) => Promise<{ channel: "sms" | "email" }>>();

vi.mock("@/lib/store/invoice-write", () => ({
  sendInvoiceDocument: (invoiceId: string) => sendMock(invoiceId),
}));

import { CloseOutDocument, SendDocumentButton } from "./close-out-document";

const inv = (over: Partial<Invoice> = {}): Invoice => ({
  id: "inv-1",
  num: "INV-1852",
  jobId: "job-1",
  leadId: "lead-1",
  cust: "Dana Reyes",
  phone: "(704) 555-0134",
  title: "Water heater replacement",
  status: "sent",
  termsDays: 0,
  lines: [{ d: "Water heater — 50 gal", q: 1, r: 185 }],
  total: 185,
  depPaid: 0,
  payments: [],
  age: 0,
  archived: false,
  ...over,
});

describe("CloseOutDocument", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ channel: "sms" });
  });

  it("shows the itemised document only once the tech asks for it", async () => {
    render(<CloseOutDocument invoice={inv()} />);
    expect(screen.queryByText("Water heater — 50 gal")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show the invoice" }));
    expect(screen.getByText("Water heater — 50 gal")).toBeTruthy();
    expect(screen.getByText("Invoice INV-1852")).toBeTruthy();
    expect(screen.getByText("Balance due")).toBeTruthy();
    // Expanded in-flow, anchored under its own control — the button reports its own state.
    expect(screen.getByRole("button", { name: "Hide the invoice" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses again", async () => {
    render(<CloseOutDocument invoice={inv()} />);
    await userEvent.click(screen.getByRole("button", { name: "Show the invoice" }));
    await userEvent.click(screen.getByRole("button", { name: "Hide the invoice" }));
    expect(screen.queryByText("Water heater — 50 gal")).toBeNull();
  });

  it("offers NO Show button in a prices-hidden shop — but still offers Send", () => {
    // The server nulls every per-line rate when techSeesPrice is off and the DTO mapper drops the
    // lines, so this device genuinely cannot build the itemised view. Sending is server-side and
    // never needs the tech to see a price, so that half still works.
    render(<CloseOutDocument invoice={inv({ lines: [] })} />);
    expect(screen.queryByRole("button", { name: /Show the invoice/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Send the invoice" })).toBeTruthy();
  });

  it("renders nothing at all on a bill with no money on it", () => {
    const { container } = render(<CloseOutDocument invoice={inv({ total: 0, lines: [] })} />);
    expect(container.textContent).toBe("");
  });
});

describe("SendDocumentButton", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ channel: "sms" });
  });

  it("says 'Send the invoice' while money is owed", () => {
    render(<SendDocumentButton invoice={inv()} />);
    expect(screen.getByRole("button", { name: "Send the invoice" })).toBeTruthy();
  });

  it("says 'Send the receipt' once the balance is settled", () => {
    render(<SendDocumentButton invoice={inv({ status: "paid", paidTotal: 185 })} />);
    expect(screen.getByRole("button", { name: "Send the receipt" })).toBeTruthy();
  });

  it("sends nothing until the tech taps it — payment never auto-sends", () => {
    render(<SendDocumentButton invoice={inv()} />);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("passes the invoice id and NOTHING else — no recipient, no channel, no copy", async () => {
    render(<SendDocumentButton invoice={inv()} />);
    await userEvent.click(screen.getByRole("button", { name: "Send the invoice" }));
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect(sendMock.mock.calls[0]).toEqual(["inv-1"]);
  });

  it("reports WHERE it went, so the tech can say 'check your texts'", async () => {
    render(<SendDocumentButton invoice={inv()} />);
    await userEvent.click(screen.getByRole("button", { name: "Send the invoice" }));
    expect(await screen.findByText("Sent by text.")).toBeTruthy();
  });

  it("says 'Sent by email' when the server routed it to email", async () => {
    sendMock.mockResolvedValue({ channel: "email" });
    render(<SendDocumentButton invoice={inv()} />);
    await userEvent.click(screen.getByRole("button", { name: "Send the invoice" }));
    expect(await screen.findByText("Sent by email.")).toBeTruthy();
  });

  it("names the server's own refusal and stays retryable — never a silent failure", async () => {
    sendMock.mockRejectedValue(new Error("this customer has no phone or email on file"));
    render(<SendDocumentButton invoice={inv()} />);
    await userEvent.click(screen.getByRole("button", { name: "Send the invoice" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("this customer has no phone or email on file");
    // No false "Sent", and the control is still live to try again.
    expect(screen.queryByText(/^Sent by/)).toBeNull();
    expect((screen.getByRole("button", { name: "Send the invoice" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("retries after a failure", async () => {
    sendMock.mockRejectedValueOnce(new Error("sms delivery is not configured"));
    render(<SendDocumentButton invoice={inv()} />);
    await userEvent.click(screen.getByRole("button", { name: "Send the invoice" }));
    await screen.findByRole("alert");

    sendMock.mockResolvedValue({ channel: "email" });
    await userEvent.click(screen.getByRole("button", { name: "Send the invoice" }));
    expect(await screen.findByText("Sent by email.")).toBeTruthy();
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("blocks a double tap while the send is in flight", async () => {
    let release: ((v: { channel: "sms" | "email" }) => void) | undefined;
    sendMock.mockReturnValue(new Promise((res) => { release = res; }));
    render(<SendDocumentButton invoice={inv()} />);

    const button = screen.getByRole("button", { name: "Send the invoice" });
    await userEvent.click(button);
    expect(screen.getByRole("button", { name: "Sending…" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Sending…" }));
    expect(sendMock).toHaveBeenCalledTimes(1);

    release?.({ channel: "sms" });
    expect(await screen.findByText("Sent by text.")).toBeTruthy();
  });

  it("offers a re-send after a successful one", async () => {
    render(<SendDocumentButton invoice={inv()} />);
    await userEvent.click(screen.getByRole("button", { name: "Send the invoice" }));
    expect(await screen.findByRole("button", { name: "Send again" })).toBeTruthy();
  });
});
