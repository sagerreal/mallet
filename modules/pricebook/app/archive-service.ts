import type { ServiceId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { ServiceRepository } from "../domain/service-repository";

export interface ArchiveServiceCommand {
  readonly serviceId: ServiceId;
}

export class ArchiveServiceUseCase {
  constructor(
    private readonly repo: ServiceRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: ArchiveServiceCommand,
    orgId: string,
  ): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.repo.archive(cmd.serviceId, this.clock.now());
    if (count === 0) return err(notFound("service not found or already archived"));

    logger.info({ serviceId: cmd.serviceId, orgId }, "pricebook.service.archived");

    return ok({ ok: true });
  }
}
