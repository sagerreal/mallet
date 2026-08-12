import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, type OrgId, type Clock } from "@mallet/shared/types";
import { UpdateDocumentsUseCase } from "./update-documents";
import { FakeSettingsRepository } from "./get-settings.test";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const NOW = new Date("2026-08-11T12:00:00Z");
const clock: Clock = { now: () => NOW };

describe("UpdateDocumentsUseCase", () => {
  let repo: FakeSettingsRepository;

  beforeEach(() => {
    repo = new FakeSettingsRepository();
  });

  it("patches the supplied slots, persists, and stamps updatedAt", async () => {
    const result = await new UpdateDocumentsUseCase(repo, clock).exec(
      {
        invoiceFooter: "Thanks for your business — 1-year warranty on labor.",
        payInstructions: "Zelle to (925) 555-0100.",
      },
      ORG,
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.docInvoiceFooter).toBe(
      "Thanks for your business — 1-year warranty on labor.",
    );
    expect(result.value.props.docInvoicePayInstructions).toBe("Zelle to (925) 555-0100.");
    expect(result.value.props.updatedAt.toISOString()).toBe(NOW.toISOString());
    // Persisted via the port, not just returned.
    expect(repo.config?.props.docInvoiceFooter).toBe(
      "Thanks for your business — 1-year warranty on labor.",
    );
  });

  it("leaves unsupplied slots untouched and clears an explicit null back to standard", async () => {
    const first = await new UpdateDocumentsUseCase(repo, clock).exec(
      { receiptNote: "Paid in full — thank you!", changeOrderAgreement: "Extra work approved." },
      ORG,
    );
    expect(isOk(first)).toBe(true);

    const second = await new UpdateDocumentsUseCase(repo, clock).exec(
      { changeOrderAgreement: null },
      ORG,
    );
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.props.docInvoiceReceiptNote).toBe("Paid in full — thank you!");
    expect(second.value.props.docChangeOrderAgreement).toBeNull();
  });

  it("stores a whitespace-only value as null — a blank override must never shadow the standard", async () => {
    const result = await new UpdateDocumentsUseCase(repo, clock).exec(
      { payInstructions: "   " },
      ORG,
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.docInvoicePayInstructions).toBeNull();
  });
});
