import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, ok, err, asChecklistId, asChecklistItemId, asOrgId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Checklist, ChecklistItemType } from "../domain/checklist";
import { CHECKLIST_MAX_ITEMS, isChecklistItemType, isChecklistStage } from "../domain/checklist";
import type { ChecklistRepository } from "../domain/checklist-repository";

export interface CreateChecklistItemInput {
  readonly id?: string;
  readonly text: string;
  readonly type: string;
  readonly required?: boolean;
}

export interface CreateChecklistCommand {
  readonly id?: string;
  readonly name: string;
  readonly trade: string;
  readonly stage: string;
  readonly match: readonly string[];
  /** Optional initial items, created atomically with the template. A pasted list
   *  is ONE mutation — the old create + addItem batch raced server-side (the
   *  addItem tx could not see the template insert → "checklist not found"). */
  readonly items?: readonly CreateChecklistItemInput[];
}

export class CreateChecklistUseCase {
  constructor(
    private readonly checklists: ChecklistRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateChecklistCommand, orgId: string): Promise<Result<Checklist, AppError>> {
    const name = cmd.name.trim();
    if (name.length === 0) return err(validation("checklist name is required", "name"));
    if (!isChecklistStage(cmd.stage)) return err(validation(`unknown checklist stage: ${cmd.stage}`, "stage"));

    const rawItems = cmd.items ?? [];
    if (rawItems.length > CHECKLIST_MAX_ITEMS) {
      return err(validation(`a checklist holds at most ${CHECKLIST_MAX_ITEMS} items`, "items"));
    }
    const items: {
      id: ReturnType<typeof asChecklistItemId>;
      text: string;
      type: ChecklistItemType;
      required: boolean;
      position: number;
    }[] = [];
    for (const [i, it] of rawItems.entries()) {
      const text = it.text.trim();
      if (text.length === 0) return err(validation("item text is required", "items"));
      if (!isChecklistItemType(it.type)) return err(validation(`unknown item type: ${it.type}`, "items"));
      items.push({
        id: asChecklistItemId(it.id ?? this.ids.newId()),
        text,
        type: it.type,
        required: it.required ?? false,
        position: i,
      });
    }

    const checklist = await this.checklists.create({
      id: asChecklistId(cmd.id ?? this.ids.newId()),
      orgId: asOrgId(orgId),
      name,
      trade: cmd.trade,
      stage: cmd.stage,
      match: cmd.match,
      ...(items.length > 0 ? { items } : {}),
    });

    logger.info(
      { checklistId: checklist.props.id, orgId, itemCount: items.length },
      "checklist.created",
    );
    return ok(checklist);
  }
}
