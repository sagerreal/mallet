import type { ServiceId } from "@mallet/shared/types";
import type { ServiceMaterial, ServiceMaterialRepository } from "../domain/service-material";

export interface ListServiceMaterialsQuery {
  readonly serviceId: ServiceId;
}

// Thin read use-case: the materials attached to one service. Tenant scoping is enforced by the
// org-scoped transaction the repository runs in, not by a parameter here.
export class ListServiceMaterialsUseCase {
  constructor(private readonly repo: ServiceMaterialRepository) {}

  exec(query: ListServiceMaterialsQuery): Promise<ServiceMaterial[]> {
    return this.repo.listForService(query.serviceId);
  }
}
