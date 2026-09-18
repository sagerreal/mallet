import type { CompanyId, Result, AppError } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { Company } from "../domain/company";
import type { CompanyRepository } from "../domain/company-repository";

export interface UpdateCompanyCommand {
  readonly companyId: CompanyId;
  readonly name?: string;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly website?: string | null;
  readonly address?: string | null;
  readonly notes?: string | null;
}

export class UpdateCompanyUseCase {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: UpdateCompanyCommand,
    orgId: string,
  ): Promise<Result<Company, AppError>> {
    const company = await this.companies.findById(cmd.companyId);
    if (!company) return err(notFound("company not found"));

    const now = this.clock.now();
    const patched = company.patch(
      {
        name: cmd.name,
        phone: cmd.phone,
        email: cmd.email,
        website: cmd.website,
        address: cmd.address,
        notes: cmd.notes,
      },
      now,
    );
    if (!patched.ok) return patched;

    await this.companies.save(patched.value);

    logger.info(
      { companyId: cmd.companyId, orgId },
      "company.updated",
    );

    return ok(patched.value);
  }
}
