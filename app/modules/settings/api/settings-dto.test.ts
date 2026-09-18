/**
 * modules/settings/api/settings-dto.test.ts
 * Unit tests for the bookingServiceDTO and bookingCfgDTO sub-schemas.
 * Asserts that the new optional fields (emergencyTriggers, deferKeywords) parse
 * correctly both when present and when absent.
 */

import { describe, it, expect } from "vitest";
import { isOk } from "@mallet/shared/types";
import {
  bookingServiceDTO,
  bookingCfgDTO,
  updateDocumentsInput,
  documentWordingDTO,
  toSettingsDTO,
  agentAutonomyDTO,
} from "./settings-dto";
import { OrgSettings } from "../domain/org-settings";
import { baseSettingsProps } from "../domain/org-settings.fixtures";
// Deep-imported (not the @mallet/agent-tasks barrel): a VALUE import of that barrel drags in the
// task router/runner's eager loadConfig() call, which blows up without DB env. ESLint's
// no-restricted-imports boundary is relaxed for test files for exactly this reason.
import { AUTONOMY_LEVELS } from "../../agent-tasks/domain/autonomy";

describe("bookingServiceDTO", () => {
  const baseService = {
    name: "Drain cleaning",
    lane: "flat" as const,
    price: 99,
    triggers: "clogged, slow drain",
  };

  it("parses a service without emergencyTriggers (optional field absent)", () => {
    const result = bookingServiceDTO.safeParse(baseService);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.emergencyTriggers).toBeUndefined();
    }
  });

  it("parses a service WITH emergencyTriggers", () => {
    const input = { ...baseService, emergencyTriggers: "burst pipe, flooding" };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.emergencyTriggers).toBe("burst pipe, flooding");
    }
  });

  it("parses a service with an empty string emergencyTriggers", () => {
    const input = { ...baseService, emergencyTriggers: "" };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.emergencyTriggers).toBe("");
    }
  });

  it("parses a service WITHOUT ballpark (optional field absent)", () => {
    const result = bookingServiceDTO.safeParse(baseService);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ballpark).toBeUndefined();
    }
  });

  it("parses a service WITH ballpark", () => {
    const input = { ...baseService, ballpark: "$150–$300" };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ballpark).toBe("$150–$300");
    }
  });

  // T3: requiredCerts

  it("parses a service WITHOUT requiredCerts (optional field absent)", () => {
    const result = bookingServiceDTO.safeParse(baseService);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiredCerts).toBeUndefined();
    }
  });

  it("parses a service WITH requiredCerts", () => {
    const input = { ...baseService, requiredCerts: ["Gas", "HVAC"] };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiredCerts).toEqual(["Gas", "HVAC"]);
    }
  });

  it("rejects a requiredCerts entry exceeding 40 characters", () => {
    const input = { ...baseService, requiredCerts: ["A".repeat(41)] };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects a requiredCerts entry that is an empty string (min 1)", () => {
    const input = { ...baseService, requiredCerts: [""] };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects more than 10 requiredCerts entries (max 10)", () => {
    const input = { ...baseService, requiredCerts: Array.from({ length: 11 }, (_, i) => `Cert${i}`) };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("strips leading/trailing whitespace from requiredCerts entries via trim()", () => {
    const input = { ...baseService, requiredCerts: ["  Gas  "] };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiredCerts).toEqual(["Gas"]);
    }
  });
});

describe("bookingCfgDTO", () => {
  const baseService = {
    name: "Drain cleaning",
    lane: "estimate" as const,
    feeApplies: true,
    triggers: "leak",
  };

  const baseCfg = {
    services: [baseService],
    notServices: "septic",
    serviceFee: 89,
    feeCredited: true,
  };

  it("parses a cfg without deferKeywords (optional field absent)", () => {
    const result = bookingCfgDTO.safeParse(baseCfg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deferKeywords).toBeUndefined();
    }
  });

  it("parses a cfg WITH deferKeywords", () => {
    const input = { ...baseCfg, deferKeywords: "insurance, claim, warranty" };
    const result = bookingCfgDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deferKeywords).toBe("insurance, claim, warranty");
    }
  });

  it("parses a service with emergencyTriggers inside a cfg", () => {
    const input = {
      ...baseCfg,
      services: [{ ...baseService, emergencyTriggers: "no heat, burst pipe" }],
      deferKeywords: "adjuster",
    };
    const result = bookingCfgDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services[0]?.emergencyTriggers).toBe("no heat, burst pipe");
      expect(result.data.deferKeywords).toBe("adjuster");
    }
  });
});

describe("updateDocumentsInput", () => {
  it("accepts a partial patch and explicit nulls", () => {
    const result = updateDocumentsInput.safeParse({
      invoiceFooter: "Thanks for your business.",
      changeOrderAgreement: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invoiceFooter).toBe("Thanks for your business.");
      expect(result.data.changeOrderAgreement).toBeNull();
      expect(result.data.payInstructions).toBeUndefined();
    }
  });

  it("caps the three invoice slots at 500 chars", () => {
    expect(updateDocumentsInput.safeParse({ invoiceFooter: "x".repeat(500) }).success).toBe(true);
    expect(updateDocumentsInput.safeParse({ invoiceFooter: "x".repeat(501) }).success).toBe(false);
    expect(updateDocumentsInput.safeParse({ payInstructions: "x".repeat(501) }).success).toBe(false);
    expect(updateDocumentsInput.safeParse({ receiptNote: "x".repeat(501) }).success).toBe(false);
  });

  it("caps the change-order agreement line at 300 chars — it sits above a signature pad", () => {
    expect(
      updateDocumentsInput.safeParse({ changeOrderAgreement: "x".repeat(300) }).success,
    ).toBe(true);
    expect(
      updateDocumentsInput.safeParse({ changeOrderAgreement: "x".repeat(301) }).success,
    ).toBe(false);
  });
});

describe("documentWordingDTO", () => {
  it("is exactly the two field-rendered slots — the anyRole disclosure contract", () => {
    // The tech surface renders the invoice footer (close-out) and the change-order agreement
    // line (sign screen). Payment instructions and the receipt note render only on the public
    // page, server-side — a technician's phone has no use for them, so they are not on the wire.
    const parsed = documentWordingDTO.safeParse({
      invoiceFooter: "Thanks!",
      changeOrderAgreement: null,
    });
    expect(parsed.success).toBe(true);
    expect(Object.keys(documentWordingDTO.shape).sort()).toEqual([
      "changeOrderAgreement",
      "invoiceFooter",
    ]);
  });
});

describe("toSettingsDTO documents projection", () => {
  it("carries the four raw overrides on the office settings payload", () => {
    const config = OrgSettings.create(
      baseSettingsProps({
        docInvoiceFooter: "Thanks!",
        docInvoicePayInstructions: null,
        docInvoiceReceiptNote: "Paid in full.",
        docChangeOrderAgreement: null,
      }),
    );
    expect(isOk(config)).toBe(true);
    if (!isOk(config)) return;
    const dto = toSettingsDTO({
      config: config.value,
      pricebook: [],
      laborRates: [],
      terms: [],
      sources: [],
    });
    expect(dto.documents).toEqual({
      invoiceFooter: "Thanks!",
      payInstructions: null,
      receiptNote: "Paid in full.",
      changeOrderAgreement: null,
    });
  });
});

describe("agentAutonomyDTO", () => {
  // DRIFT TRIPWIRE: agentAutonomyDTO's z.enum(...) is a literal copy of AUTONOMY_LEVELS,
  // duplicated (not imported) because a VALUE import of the @mallet/agent-tasks barrel would
  // pull in the task runner's eager loadConfig() call. Zod's enum has no link back to the
  // source union, so a level added to AUTONOMY_LEVELS but missed here would compile clean and
  // this schema would silently reject the new value at the API boundary — this only catches
  // that by actually parsing every real level.
  it("parses every AUTONOMY_LEVELS value", () => {
    for (const level of AUTONOMY_LEVELS) {
      const parsed = agentAutonomyDTO.safeParse(level);
      expect(parsed.success).toBe(true);
    }
  });
});
