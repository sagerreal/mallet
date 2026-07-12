import { describe, it, expect, beforeEach } from "vitest";
import { asChecklistId, asChecklistItemId, FixedClock, isOk } from "@mallet/shared/types";
import { FakeChecklistRepository, ORG } from "./create-checklist.test";
import { CreateChecklistUseCase } from "./create-checklist";
import { AddItemUseCase, type AddItemCommand } from "./add-item";

const MINTED_CHECKLIST = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const MINTED_ITEM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const MISSING_CHECKLIST_ID = asChecklistId("00000000-0000-0000-0000-000000000000");

describe("AddItemUseCase", () => {
  let clock: FixedClock;
  let repo: FakeChecklistRepository;
  let useCase: AddItemUseCase;
  let createUseCase: CreateChecklistUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeChecklistRepository();
    useCase = new AddItemUseCase(repo, clock, { newId: () => MINTED_ITEM });
    createUseCase = new CreateChecklistUseCase(repo, clock, { newId: () => MINTED_CHECKLIST });
  });

  it("rejects an empty text without calling the repo", async () => {
    const created = await createUseCase.exec({ name: "Heater check", trade: "HVAC", stage: "job", match: [] }, ORG);
    if (!created.ok) throw new Error("setup failed");

    repo.lastAddedInput = undefined;
    const cmd: AddItemCommand = { checklistId: created.value.props.id, text: "  ", type: "check" };
    const r = await useCase.exec(cmd, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect(repo.lastAddedInput).toBeUndefined();
  });

  it("rejects an unknown item type", async () => {
    const created = await createUseCase.exec({ name: "Heater check", trade: "HVAC", stage: "job", match: [] }, ORG);
    if (!created.ok) throw new Error("setup failed");

    const cmd = {
      checklistId: created.value.props.id,
      text: "Step one",
      type: "video",
    } as unknown as AddItemCommand;
    const r = await useCase.exec(cmd, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
  });

  it("returns not_found when the checklist does not exist", async () => {
    const cmd: AddItemCommand = { checklistId: MISSING_CHECKLIST_ID, text: "Check it", type: "check" };
    const r = await useCase.exec(cmd, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("mints a new item id when none is provided", async () => {
    const created = await createUseCase.exec({ name: "Heater check", trade: "HVAC", stage: "job", match: [] }, ORG);
    if (!created.ok) throw new Error("setup failed");

    const cmd: AddItemCommand = { checklistId: created.value.props.id, text: "Step one", type: "check" };
    const r = await useCase.exec(cmd, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.lastAddedInput?.id).toBe(MINTED_ITEM);
  });

  it("uses caller-provided item id when supplied", async () => {
    const created = await createUseCase.exec({ name: "Heater check", trade: "HVAC", stage: "job", match: [] }, ORG);
    if (!created.ok) throw new Error("setup failed");

    const callerItemId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const cmd: AddItemCommand = {
      checklistId: created.value.props.id,
      id: callerItemId,
      text: "Step two",
      type: "photo",
    };
    await useCase.exec(cmd, ORG);
    expect(repo.lastAddedInput?.id).toBe(callerItemId);
  });

  it("passes position = 0 for the first item", async () => {
    const created = await createUseCase.exec({ name: "Heater check", trade: "HVAC", stage: "job", match: [] }, ORG);
    if (!created.ok) throw new Error("setup failed");

    const cmd: AddItemCommand = { checklistId: created.value.props.id, text: "First step", type: "check" };
    await useCase.exec(cmd, ORG);
    expect(repo.lastAddedInput?.position).toBe(0);
  });

  it("passes trimmed text to the repo", async () => {
    const created = await createUseCase.exec({ name: "Heater check", trade: "HVAC", stage: "job", match: [] }, ORG);
    if (!created.ok) throw new Error("setup failed");

    const cmd: AddItemCommand = { checklistId: created.value.props.id, text: "  Check valve  ", type: "check" };
    await useCase.exec(cmd, ORG);
    expect(repo.lastAddedInput?.text).toBe("Check valve");
  });

  it("passes required: false by default", async () => {
    const created = await createUseCase.exec({ name: "Heater check", trade: "HVAC", stage: "job", match: [] }, ORG);
    if (!created.ok) throw new Error("setup failed");

    const cmd: AddItemCommand = { checklistId: created.value.props.id, text: "Take photo", type: "photo" };
    await useCase.exec(cmd, ORG);
    expect(repo.lastAddedInput?.required).toBe(false);
  });

  it("rejects the 51st item so every template stays attachable to a job (≤ 50 items)", async () => {
    const created = await createUseCase.exec({ name: "Heater check", trade: "HVAC", stage: "job", match: [] }, ORG);
    if (!created.ok) throw new Error("setup failed");

    let n = 0;
    const filler = new AddItemUseCase(repo, clock, {
      newId: () => `${String(++n).padStart(8, "0")}-0000-0000-0000-000000000000`,
    });
    for (let i = 0; i < 50; i++) {
      const r = await filler.exec(
        { checklistId: created.value.props.id, text: `Step ${i + 1}`, type: "check" },
        ORG,
      );
      expect(isOk(r)).toBe(true);
    }

    repo.lastAddedInput = undefined;
    const overflow = await useCase.exec(
      { checklistId: created.value.props.id, text: "One too many", type: "check" },
      ORG,
    );
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.error.kind).toBe("validation");
    expect(repo.lastAddedInput).toBeUndefined();
  });
});
