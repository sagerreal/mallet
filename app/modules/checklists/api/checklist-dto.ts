import { z } from "zod";
import type { Checklist } from "../domain/checklist";

export const checklistItemDTO = z.object({
  id: z.string().uuid(),
  text: z.string(),
  type: z.enum(["check", "photo"]),
  required: z.boolean(),
  position: z.number().int().min(0),
});

export const checklistDTO = z.object({
  id: z.string().uuid(),
  name: z.string(),
  trade: z.string(),
  stage: z.enum(["job", "scope"]),
  match: z.array(z.string()),
  items: z.array(checklistItemDTO),
  createdAt: z.string(),
});

export type ChecklistDTO = z.infer<typeof checklistDTO>;

export const toChecklistDTO = (checklist: Checklist): ChecklistDTO => {
  const p = checklist.props;
  return {
    id: p.id,
    name: p.name,
    trade: p.trade,
    stage: p.stage,
    match: [...p.match],
    items: p.items.map((it) => ({
      id: it.props.id,
      text: it.props.text,
      type: it.props.type,
      required: it.props.required,
      position: it.props.position,
    })),
    createdAt: p.createdAt.toISOString(),
  };
};
