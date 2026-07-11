import { describe, it, expect, beforeEach } from "vitest";
import { asChecklistId, asChecklistItemId, FixedClock, isOk } from "@mallet/shared/types";
import { FakeChecklistRepository, ORG } from "./create-checklist.test";
import { CreateChecklistUseCase } from "./create-checklist";
import { RemoveItemUseCase, type RemoveItemCommand } from "./remove-item";

const MINTED_CHECKLIST = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const MISSING_CHECKLIST_ID = asChecklistId("00000000-0000-0000-0000-000000000000");
const ITEM_ID = asChecklistItemId("cccccccc-cccc-cccc-cccc-cccccccccccc");

describe("RemoveItemUseCase", () => {
  let clock: FixedClock;
  let repo: FakeChecklistRepository;
  let useCase: RemoveItemUseCase;
  let createUseCase: CreateChecklistUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeChecklistRepository();
    useCase = new RemoveItemUseCase(repo, clock);
    createUseCase = new CreateChecklistUseCase(repo, clock, { newId: () => MINTED_CHECKLIST });
  });

  it("returns not_found when the checklist does not exist", async () => {
    const cmd: RemoveItemCommand = { checklistId: MISSING_CHECKLIST_ID, itemId: ITEM_ID };
    const r = await useCase.exec(cmd, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("returns ok with the reloaded aggregate when the item is removed", async () => {
    const created = await createUseCase.exec({ name: "Pipeline check", trade: "Plumbing", stage: "job", match: [] }, ORG);
    if (!created.ok) throw new Error("setup failed");

    const cmd: RemoveItemCommand = { checklistId: created.value.props.id, itemId: ITEM_ID };
    const r = await useCase.exec(cmd, ORG);
    expect(isOk(r)).toBe(true);
  });
});
