import type { Result, AppError, OrgId } from "@mallet/shared/types";
import { ok, err, notFound, asChecklistId, asChecklistItemId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Checklist, ChecklistItemType } from "../domain/checklist";
import { CHECKLIST_MAX_ITEMS, ChecklistItem, Checklist as ChecklistDomain, isChecklistItemType } from "../domain/checklist";
import type { ChecklistRepository } from "../domain/checklist-repository";
import type { ChecklistId } from "@mallet/shared/types";

export interface UpdateChecklistItemInput {
  readonly text: string;
  readonly type: ChecklistItemType | string;
  readonly required?: boolean;
}

export interface UpdateChecklistCommand {
  readonly checklistId: ChecklistId | string;
  readonly name: string;
  readonly items: readonly UpdateChecklistItemInput[];
}

// Validate each raw item through the domain value object; return err on the first failure.
// Positions are set to the item's index in the array. Returns the DOMAIN objects so the header
// factory can reuse them directly (no re-validation, no unreachable-throw path).
function validateItems(
  rawItems: readonly UpdateChecklistItemInput[],
  ids: IdGenerator,
): Result<readonly ChecklistItem[], AppError> {
  if (rawItems.length > CHECKLIST_MAX_ITEMS) {
    return err({ kind: "validation", message: `a checklist holds at most ${CHECKLIST_MAX_ITEMS} items`, field: "items" });
  }

  const validated: ChecklistItem[] = [];
  for (const [i, raw] of rawItems.entries()) {
    if (!isChecklistItemType(raw.type)) {
      return err({ kind: "validation", message: `unknown item type: ${raw.type}`, field: "type" });
    }
    const itemResult = ChecklistItem.create({
      id: asChecklistItemId(ids.newId()),
      text: raw.text.trim(),
      type: raw.type,
      required: raw.required ?? false,
      position: i,
    });
    if (!itemResult.ok) return itemResult;
    validated.push(itemResult.value);
  }
  return ok(validated);
}

// Validate the header via the domain factory (enforces name non-empty, stage, etc.), reusing the
// already-validated ChecklistItem domain objects — no second ChecklistItem.create pass.
function validateHeader(
  name: string,
  items: readonly ChecklistItem[],
): Result<string, AppError> {
  const trimmed = name.trim();
  const checklistResult = ChecklistDomain.create({
    id: asChecklistId("00000000-0000-0000-0000-000000000000"),
    orgId: "00000000-0000-0000-0000-000000000000" as OrgId,
    name: trimmed,
    trade: "Custom",
    stage: "job",
    match: [],
    items: [...items],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (!checklistResult.ok) return checklistResult;
  return ok(trimmed);
}

export class UpdateChecklistUseCase {
  constructor(
    private readonly checklists: ChecklistRepository,
    private readonly ids: IdGenerator,
  ) {}

  async exec(
    cmd: UpdateChecklistCommand,
    orgId: OrgId,
  ): Promise<Result<Checklist, AppError>> {
    // 1. Validate items first (fail fast; no writes on invalid input).
    const itemsResult = validateItems(cmd.items, this.ids);
    if (!itemsResult.ok) return itemsResult;
    const validatedItems = itemsResult.value;

    // 2. Validate header via the domain factory.
    const nameResult = validateHeader(cmd.name, validatedItems);
    if (!nameResult.ok) return nameResult;
    const trimmedName = nameResult.value;

    // 3. Atomically replace name + items in the repo (repo takes the flat row shape).
    const updated = await this.checklists.update({
      id: asChecklistId(cmd.checklistId as string),
      name: trimmedName,
      items: validatedItems.map((it) => it.props),
    });

    if (updated === null) {
      return err(notFound("checklist"));
    }

    logger.info(
      { checklistId: cmd.checklistId, orgId, itemCount: validatedItems.length },
      "checklist.updated",
    );
    return ok(updated);
  }
}
