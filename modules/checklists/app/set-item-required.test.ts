import { describe, it, expect, beforeEach } from "vitest";
import { asChecklistId, asChecklistItemId, FixedClock, isOk } from "@mallet/shared/types";
import { FakeChecklistRepository, ORG } from "./create-checklist.test";
import { CreateChecklistUseCase } from "./create-checklist";
import { SetItemRequiredUseCase, type SetItemRequiredCommand } from "./set-item-required";

const MINTED_CHECKLIST = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const MISSING_CHECKLIST_ID = asChecklistId("00000000-0000-0000-0000-000000000000");
const ITEM_ID = asChecklistItemId("dddddddd-dddd-dddd-dddd-dddddddddddd");

describe("SetItemRequiredUseCase", () => {
  let clock: FixedClock;
  let repo: FakeChecklistRepository;
  let useCase: SetItemRequiredUseCase;
  let createUseCase: CreateChecklistUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeChecklistRepository();
    useCase = new SetItemRequiredUseCase(repo, clock);
    createUseCase = new CreateChecklistUseCase(repo, clock, { newId: () => MINTED_CHECKLIST });
  });

  it("returns not_found when the checklist does not exist", async () => {
    const cmd: SetItemRequiredCommand = { checklistId: MISSING_CHECKLIST_ID, itemId: ITEM_ID, required: true };
    const r = await useCase.exec(cmd, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("returns ok with the reloaded aggregate on a hit", async () => {
    const created = await createUseCase.exec({ name: "Safety check", trade: "Electrical", stage: "scope", match: [] }, ORG);
    if (!created.ok) throw new Error("setup failed");

    const cmd: SetItemRequiredCommand = {
      checklistId: created.value.props.id,
      itemId: ITEM_ID,
      required: true,
    };
    const r = await useCase.exec(cmd, ORG);
    expect(isOk(r)).toBe(true);
  });

  it("returns ok when setting required to false", async () => {
    const created = await createUseCase.exec({ name: "Safety check", trade: "Electrical", stage: "scope", match: [] }, ORG);
    if (!created.ok) throw new Error("setup failed");

    const cmd: SetItemRequiredCommand = {
      checklistId: created.value.props.id,
      itemId: ITEM_ID,
      required: false,
    };
    const r = await useCase.exec(cmd, ORG);
    expect(isOk(r)).toBe(true);
  });
});
