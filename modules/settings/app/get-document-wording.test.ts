import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, type OrgId } from "@mallet/shared/types";
import { GetDocumentWordingUseCase } from "./get-document-wording";
import { FakeSettingsRepository } from "./get-settings.test";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const NOW = new Date("2026-08-11T12:00:00Z");

/**
 * The narrow read behind the anyRole documentWording endpoint and the public invoice page.
 * Raw overrides only (null = standard wording); the render seams resolve effective text via
 * domain/document-wording.ts so client and server cannot disagree about the fallback.
 */
describe("GetDocumentWordingUseCase", () => {
  let repo: FakeSettingsRepository;

  beforeEach(() => {
    repo = new FakeSettingsRepository();
  });

  it("reads all-null for an org that never touched the slots", async () => {
    const result = await new GetDocumentWordingUseCase(repo).exec(ORG);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toEqual({
      invoiceFooter: null,
      payInstructions: null,
      receiptNote: null,
      changeOrderAgreement: null,
    });
  });

  it("projects the four stored overrides", async () => {
    const seeded = await repo.getConfig(ORG, () => ({
      services: [],
      notServices: "",
      serviceFee: 89,
      feeCredited: true,
    }));
    const patched = seeded.patchDocuments(
      {
        invoiceFooter: "Thanks!",
        payInstructions: "Zelle to (925) 555-0100.",
        receiptNote: "Paid in full.",
        changeOrderAgreement: "Extra work approved, billed with the job.",
      },
      NOW,
    );
    expect(isOk(patched)).toBe(true);
    if (!isOk(patched)) return;
    repo.config = patched.value;

    const result = await new GetDocumentWordingUseCase(repo).exec(ORG);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toEqual({
      invoiceFooter: "Thanks!",
      payInstructions: "Zelle to (925) 555-0100.",
      receiptNote: "Paid in full.",
      changeOrderAgreement: "Extra work approved, billed with the job.",
    });
  });

  /** The disclosure contract: exactly four keys, every one already shown to customers. */
  it("returns FOUR fields — no office configuration can leak through it", async () => {
    const result = await new GetDocumentWordingUseCase(repo).exec(ORG);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(Object.keys(result.value).sort()).toEqual([
      "changeOrderAgreement",
      "invoiceFooter",
      "payInstructions",
      "receiptNote",
    ]);
  });
});
