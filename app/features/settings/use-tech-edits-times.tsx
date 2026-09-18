"use client";

/**
 * features/settings/use-tech-edits-times.tsx
 * "May this technician correct his own hours?" — the org's own answer, on the surface that has to
 * draw or withhold the pencil.
 *
 * WHY IT EXISTS. The server has enforced this since #457 (`assertTechMayEditTimes`), and the field
 * surface never asked. So on a shop with hand edits OFF — which is the DEFAULT, the Housecall Pro
 * model — the technician saw an Edit control, opened it, typed a correction, saved, and got a
 * refusal. A button whose only possible outcome is an error message is worse than no button: it
 * teaches him the app is broken, on the screen where he is already worried about his pay.
 *
 * FAILS CLOSED, and here that is not a judgement call. The server will refuse the write when the
 * answer is no; drawing the control on "we do not know yet" can only ever produce that refusal.
 *
 * SERVER-SEEDED, THEN LIVE — the same shape as `useCanText`, `useMeasurementGate` and
 * `useOvertimePolicy`, and it rides the SAME `v1.settings.fieldToggles` payload the field layout
 * already resolves per request, so it costs no extra call. Without the seed the pencil would appear
 * a beat after first paint on shops that allow edits, and (worse) flash into view and stay on shops
 * that do not, since an empty cache is indistinguishable from a "yes".
 *
 *   query landed → the query   (the office flips the toggle; the pencil follows without a reload)
 *   seeded       → the seed    (this request's own server read)
 *   neither      → NO          (the server would refuse anyway)
 */

import { createContext, useContext, type ReactNode } from "react";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import type { TechEditsSeed } from "@/lib/field-toggles-seed";

const TechEditsContext = createContext<TechEditsSeed>("unknown");

export function TechEditsProvider({ seed, children }: { seed: TechEditsSeed; children: ReactNode }) {
  return <TechEditsContext.Provider value={seed}>{children}</TechEditsContext.Provider>;
}

export function useTechEditsTimes(): boolean {
  const seeded = useContext(TechEditsContext);
  const { data } = api.v1.settings.fieldToggles.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });
  return data ? data.techEditsTimes === true : seeded === "yes";
}
