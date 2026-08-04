/**
 * lib/measurement-gate.ts
 *
 * Whether this org prices off measurements — as THREE states, not two.
 *
 * WHY A TRI-STATE. `store.toggles.measurementEstimating` used to be a boolean whose
 * pre-hydration placeholder was `false`, and `SettingsHydrator` is its only writer. So
 * "the shop does not measure" and "no settings snapshot has arrived yet" were the same
 * value, and every reader treated both as off. One 500 from `v1.settings.get` — which
 * happened for real once, on a malformed settings blob — therefore removed the composer's
 * whole Measure card and the field Quote tab's "Scan a room" row, with no reason shown
 * anywhere. The app's only native capability (the RoomPlan LiDAR scanner, and the whole
 * answer to App Store guideline 4.2) silently ceased to exist because a read failed.
 *
 * A second boolean flag beside the toggle would have fixed today's three call sites and
 * been forgotten at the fourth. A tri-state cannot be forgotten: `"unknown"` is not
 * falsy, so every reader has to say which way it fails, in code, at the call site.
 *
 * WHICH WAY EACH READER FAILS. Not the same way, deliberately:
 *
 *  - The NATIVE AFFORDANCES fail OPEN (`measurementSurfacesVisible`). A capability that
 *    might exist must be shown and, if it truly cannot run, say why — an unexplained
 *    absence is the exact failure this whole branch exists to kill. The cost of showing
 *    a Measure card to a shop that turns out not to measure is one card too many; the
 *    cost of hiding it is an App Review rejection and a feature that appears to be gone.
 *
 *    OPEN MEANS VISIBLE, NOT LIVE. On `"unknown"` the surfaces render the control DISABLED
 *    with the `settings-unknown` reason (components/shared/scan-unavailable.tsx), because
 *    tapping it creates an estimate job server-side: a live scanner during a settings outage
 *    writes rows into a shop that may have turned measuring off on purpose. A disabled row
 *    costs a reload; a live one costs data. That is the whole trade this tri-state encodes.
 *
 * WHERE `"unknown"` COMES FROM NOW. It used to be the state of every first paint, because the
 * only writers were client hydrators. The gate is now resolved SERVER-SIDE in the office and
 * field layouts (lib/auth/server-measurement-gate.ts) and read through
 * `features/settings/measurement-gate-provider.tsx`, so a logged-in user's first HTML already
 * carries `"on"`/`"off"`. `"unknown"` therefore means what it says — the read failed — instead
 * of "ask again in a moment", which is why it is now safe for it to disable rather than hide.
 *  - The PRICEBOOK EDITOR's measured "Priced by" options fail CLOSED
 *    (`measurementConfirmed`). Those options write a `measuredBy` unit onto a saved
 *    service — a real edit to the shop's catalogue — so they need a confirmed yes, not a
 *    guess. Offering "per sq ft" to a plumber during a settings outage would invite data
 *    the shop cannot use; withholding it costs a reload.
 */

/**
 * `"on"`/`"off"` = a settings snapshot arrived and said so.
 * `"unknown"` = none has arrived (pre-hydration, a failed read, or a surface with no
 * settings reader at all). It is NOT a synonym for "off" — see the module note.
 */
export type MeasurementGate = "on" | "off" | "unknown";

/** Map a settings snapshot's boolean onto the gate. The only place that widening happens. */
export function measurementGateFrom(measurementEstimating: boolean): MeasurementGate {
  return measurementEstimating ? "on" : "off";
}

/**
 * Should this surface offer its measurement/scan affordance? FAILS OPEN — only a snapshot
 * that actually arrived and said "off" hides it. Use for the native scan controls, the
 * composer's Measure card, and anything whose absence would read as "the feature is gone".
 */
export function measurementSurfacesVisible(gate: MeasurementGate): boolean {
  return gate !== "off";
}

/**
 * Is this org CONFIRMED to price off measurements? FAILS CLOSED — `"unknown"` is a no.
 * Use for controls that write measurement units into the shop's own data.
 */
export function measurementConfirmed(gate: MeasurementGate): boolean {
  return gate === "on";
}
