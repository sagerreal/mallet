import type { CompanyId, Phone, Result, AppError, Clock } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Lead } from "../domain/lead";
import type { LeadRepository } from "../domain/lead-repository";

export interface EnsureCustomerCommand {
  readonly name: string;
  readonly phone: Phone | null;
  readonly email: string | null;
  readonly source: string | null;
  readonly companyId: CompanyId | null;
  readonly role: string | null;
}

// Get-or-create a customer. Validation lives here and in the domain factory; the repository
// guarantees idempotency on phone. A "customer.created" event is emitted only for genuinely
// new customers (so downstream reactions don't fire on a dedupe hit).
export class EnsureCustomerUseCase {
  constructor(
    private readonly leads: LeadRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: EnsureCustomerCommand): Promise<Result<Lead, AppError>> {
    const name = cmd.name.trim();
    if (name.length === 0) return err(validation("lead name is required", "name"));

    const { lead, created } = await this.leads.ensureCustomer({
      name,
      phone: cmd.phone,
      email: cmd.email,
      source: cmd.source,
      companyId: cmd.companyId,
      role: cmd.role,
    });

    if (created) {
      await this.bus.emit({
        name: "customer.created",
        orgId: lead.props.orgId,
        payload: { leadId: lead.props.id, source: lead.props.source },
        occurredAt: this.clock.now(),
      });
    }

    return ok(lead);
  }
}
