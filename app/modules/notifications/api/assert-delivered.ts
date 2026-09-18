import { TRPCError } from "@trpc/server";
import type { Notification } from "../domain/notification";
import { STUB_EXTERNAL_ID } from "../infra/logging-notification-sender";

/**
 * Interactive sends must surface delivery truth.
 *
 * `SendNotificationUseCase` records provider failures gracefully (status='failed', returned as ok)
 * so the BACKGROUND reminder path never hard-fails — but a human who just tapped Send needs the
 * real outcome. An unconfigured channel (the logging-stub sentinel) or a provider rejection has to
 * THROW, so the caller's inline error handling fires instead of showing a false success.
 *
 * Lives in its own file because two routers need it: the office notification router and the
 * technician's `fieldInvoicing.sendDocument`. A tech at a customer's door being told "Sent" when
 * nothing left the building is the same lie as the office version of it, and there should be one
 * definition of what counts as delivered.
 */
export const assertDelivered = (n: Notification, channel: string): Notification => {
  const p = n.props;
  if (p.externalId === STUB_EXTERNAL_ID) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${channel} delivery is not configured`,
    });
  }
  if (p.status === "failed") {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `the ${channel} provider rejected the send`,
    });
  }
  return n;
};
