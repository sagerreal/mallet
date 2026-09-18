"use client";

/**
 * lib/analytics/analytics-identify.tsx
 * Ties the session to a person and their shop, from the identity the shell already has.
 *
 * Takes the SERVER-RESOLVED me rather than calling useMe: the office and field layouts already
 * awaited it, so a second query would be a round trip to learn something the page was rendered
 * with. It also means identify happens on first paint, not after — events fired in the first second
 * of a cold load would otherwise be attributed to an anonymous person and never joined back.
 *
 * Mounted only inside the AUTHED shells. At the root it would run on /login and /signup, where
 * there is no identity to send.
 */

import { useEffect } from "react";
import { identify } from "./track";

export interface AnalyticsIdentifyProps {
  readonly userId: string;
  readonly orgId: string;
  readonly role: string;
}

export function AnalyticsIdentify({ userId, orgId, role }: AnalyticsIdentifyProps) {
  useEffect(() => {
    identify({ userId, orgId, role });
  }, [userId, orgId, role]);
  return null;
}
