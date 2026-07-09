import type { TaskId, Result, AppError } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { TaskRepository } from "../domain/task-repository";

export interface RemoveTaskCommand {
  readonly taskId: TaskId;
}

export class RemoveTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: RemoveTaskCommand,
    orgId: string,
  ): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.tasks.remove(cmd.taskId, this.clock.now());
    if (count === 0) return err(notFound("task not found or already removed"));

    logger.info(
      { taskId: cmd.taskId, orgId },
      "task.removed",
    );

    return ok({ ok: true });
  }
}
