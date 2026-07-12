import type { ChecklistId, Result, AppError, Clock } from "@mallet/shared/types";
import { validation, notFound, ok, err, asChecklistItemId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Checklist } from "../domain/checklist";
import { CHECKLIST_MAX_ITEMS, isChecklistItemType } from "../domain/checklist";
import type { ChecklistRepository } from "../domain/checklist-repository";

export interface AddItemCommand {
  readonly checklistId: ChecklistId;
  readonly id?: string;
  readonly text: string;
  readonly type: string;
}

export class AddItemUseCase {
  constructor(
    private readonly checklists: ChecklistRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: AddItemCommand, orgId: string): Promise<Result<Checklist, AppError>> {
    const text = cmd.text.trim();
    if (text.length === 0) return err(validation("item text is required", "text"));
    if (!isChecklistItemType(cmd.type)) return err(validation(`unknown item type: ${cmd.type}`, "type"));

    const template = await this.checklists.findById(cmd.checklistId);
    if (!template) return err(notFound("checklist not found"));

    // Cap the template at the job-attach limit so every template stays attachable.
    // Enforced on add only — a pre-existing over-limit template is not rewritten.
    if (template.props.items.length >= CHECKLIST_MAX_ITEMS) {
      return err(
        validation(`a checklist holds at most ${CHECKLIST_MAX_ITEMS} items`, "text"),
      );
    }

    // Append: position = current item count (0-based), preserving order.
    const position = template.props.items.length;
    const updated = await this.checklists.addItem({
      id: asChecklistItemId(cmd.id ?? this.ids.newId()),
      templateId: cmd.checklistId,
      text,
      type: cmd.type,
      required: false,
      position,
    });

    logger.info({ checklistId: cmd.checklistId, orgId }, "checklist.item_added");
    return ok(updated);
  }
}
