import type { Result, AppError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { Company } from "../domain/company";
import type { CompanyRepository } from "../domain/company-repository";

export interface CreateCompanyCommand {
  readonly id?: string; // client-authored id; a new one is minted when absent
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
  readonly address: string | null;
  readonly notes: string | null;
}

export class CreateCompanyUseCase {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(
    cmd: CreateCompanyCommand,
    orgId: string,
  ): Promise<Result<Company, AppError>> {
    const name = cmd.name.trim();
    if (name.length === 0) return err(validation("company name is required", "name"));

    const company = await this.companies.create({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      name,
      phone: cmd.phone,
      email: cmd.email,
      website: cmd.website,
      address: cmd.address,
      notes: cmd.notes,
    });

    logger.info(
      { companyId: company.props.id, orgId },
      "company.created",
    );

    return ok(company);
  }
}
