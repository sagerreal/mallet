import type { A2pStatus } from "../domain/registration";
import type { A2pTenantRunner } from "./begin-registration";

export interface A2pStatusView {
  status: A2pStatus;
  canText: boolean;
  needsInput: boolean;
  failureReason: string | null;
}

/**
 * Projects an A2pRegistration down to a UI view. When no registration exists,
 * returns a `not_started` view.
 *
 * `canText`: true only when `status === "active"`.
 * `needsInput`: true when `status === "not_started" || status === "failed"`.
 */
export class GetA2pStatusUseCase {
  constructor(private readonly run: A2pTenantRunner) {}

  async exec(orgId: string): Promise<A2pStatusView> {
    const reg = await this.run(async (repo) => {
      return repo.get(orgId);
    });

    if (!reg) {
      return {
        status: "not_started",
        canText: false,
        needsInput: true,
        failureReason: null,
      };
    }

    return {
      status: reg.props.status,
      canText: reg.props.status === "active",
      needsInput: reg.props.status === "not_started" || reg.props.status === "failed",
      failureReason: reg.props.failureReason,
    };
  }
}
