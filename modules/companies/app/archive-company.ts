import type { CompanyId, Result, AppError } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { CompanyRepository } from "../domain/company-repository";

export interface ArchiveCompanyCommand {
  readonly companyId: CompanyId;
}

export class ArchiveCompanyUseCase {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: ArchiveCompanyCommand,
    orgId: string,
  ): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.companies.archive(cmd.companyId, this.clock.now());
    if (count === 0) return err(notFound("company not found or already archived"));

    logger.info(
      { companyId: cmd.companyId, orgId },
      "company.archived",
    );

    return ok({ ok: true });
  }
}
