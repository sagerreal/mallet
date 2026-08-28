import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, isErr, FixedClock, type OrgId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { FakePurchaseOrderRepository } from "./list-purchase-orders.test";
import { AddPurchaseOrderNoteUseCase, type AddPurchaseOrderNoteCommand } from "./add-purchase-order-note";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const OTHER_ORG: OrgId = asOrgId("33333333-3333-3333-3333-333333333333");
const CLOCK = new FixedClock(new Date("2026-08-28T00:00:00Z"));

const seqIds = (): IdGenerator => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

describe("AddPurchaseOrderNoteUseCase", () => {
  let repo: FakePurchaseOrderRepository;
  beforeEach(() => {
    repo = new FakePurchaseOrderRepository();
  });

  it("accepts an attachment with empty text — a photo of the receipt needs no caption", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1 });
    const cmd: AddPurchaseOrderNoteCommand = {
      poId: id,
      body: "",
      authorUserId: null,
      attachment: { path: "po-notes/receipt.jpg", name: "receipt.jpg", type: "image/jpeg" },
    };
    const r = await new AddPurchaseOrderNoteUseCase(repo, CLOCK, seqIds()).exec(ORG, cmd);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.body).toBe("");
      expect(r.value.attachmentPath).toBe("po-notes/receipt.jpg");
    }
  });

  it("accepts plain text with no attachment", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1 });
    const cmd: AddPurchaseOrderNoteCommand = { poId: id, body: "Called Ferguson, backordered a week", authorUserId: null };
    const r = await new AddPurchaseOrderNoteUseCase(repo, CLOCK, seqIds()).exec(ORG, cmd);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.body).toBe("Called Ferguson, backordered a week");
  });

  it("refuses an empty note with no attachment", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1 });
    const cmd: AddPurchaseOrderNoteCommand = { poId: id, body: "   ", authorUserId: null };
    const r = await new AddPurchaseOrderNoteUseCase(repo, CLOCK, seqIds()).exec(ORG, cmd);
    expect(isErr(r)).toBe(true);
  });

  it("persists the note so listNotes sees it", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1 });
    const cmd: AddPurchaseOrderNoteCommand = { poId: id, body: "Backordered", authorUserId: null };
    await new AddPurchaseOrderNoteUseCase(repo, CLOCK, seqIds()).exec(ORG, cmd);
    const notes = await repo.listNotes(id);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toBe("Backordered");
  });

  it("is a NOT_FOUND for an id in another org", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1, orgId: OTHER_ORG });
    const cmd: AddPurchaseOrderNoteCommand = { poId: id, body: "Backordered", authorUserId: null };
    const r = await new AddPurchaseOrderNoteUseCase(repo, CLOCK, seqIds()).exec(ORG, cmd);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });
});
