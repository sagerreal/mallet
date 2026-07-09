import { z } from "zod";
import type { Task } from "../domain/task";

export const taskDTO = z.object({
  id: z.string().uuid(),
  leadId: z.string().uuid().nullable(),
  text: z.string(),
  dueDate: z.string().nullable(),
  done: z.boolean(),
  createdAt: z.string(),
});

export type TaskDTO = z.infer<typeof taskDTO>;

export const toTaskDTO = (task: Task): TaskDTO => {
  const p = task.props;
  return {
    id: p.id,
    leadId: p.leadId,
    text: p.text,
    dueDate: p.dueDate,
    done: p.done,
    createdAt: p.createdAt.toISOString(),
  };
};
