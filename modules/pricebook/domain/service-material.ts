import type { MaterialId, OrgId, Result, ServiceId, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export interface ServiceMaterialProps {
  readonly orgId: OrgId;
  readonly serviceId: ServiceId;
  readonly materialId: MaterialId;
  readonly quantity: number;
}

// The service↔material join — how many of a material build a Service's cost basis. Immutable
// value object; the factory enforces invariants so an invalid ServiceMaterial cannot exist.
export class ServiceMaterial {
  private constructor(private readonly p: ServiceMaterialProps) {}

  static create(props: ServiceMaterialProps): Result<ServiceMaterial, ValidationError> {
    if (props.quantity <= 0) {
      return err(validation("quantity must be > 0", "quantity"));
    }
    return ok(new ServiceMaterial({ ...props }));
  }

  get props(): ServiceMaterialProps {
    return this.p;
  }
}

// The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
// is constructed with, so a caller physically cannot address another tenant's join rows.
export interface ServiceMaterialRepository {
  // Upsert on the (serviceId, materialId) primary key — attaching an already-attached material
  // updates its quantity rather than erroring.
  attach(input: {
    orgId: string;
    serviceId: ServiceId;
    materialId: MaterialId;
    quantity: number;
  }): Promise<void>;

  // Returns the number of rows affected (0 = not attached).
  detach(serviceId: ServiceId, materialId: MaterialId): Promise<number>;

  listForService(serviceId: ServiceId): Promise<ServiceMaterial[]>;

  // ONE query for many services — avoids N+1 when hydrating a page of services.
  listForServices(serviceIds: string[]): Promise<ServiceMaterial[]>;
}
