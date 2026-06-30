import { liveness } from "@mallet/shared/observability";

// Liveness probe — process is up. No dependency checks (a failure here means "restart me").
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(liveness());
}
