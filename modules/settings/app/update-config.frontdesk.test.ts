import { describe, it, expect } from "vitest";
import { UpdateConfigUseCase } from "./update-config";
import { OrgSettings, type OrgSettingsProps } from "../domain/org-settings";
import type { Clock } from "@mallet/shared/types";
import { baseSettingsProps } from "../domain/org-settings.fixtures";

/**
 * The front desk cannot be switched on unready.
 *
 * frontDeskReadiness existed from the day front_desk's default was flipped to false, and nothing
 * ever called it — so the toggle was a plain checkbox and the rule was a comment. One live shop is
 * switched ON with no service area: its AI answers real customers on the shop's own number knowing
 * nothing about where it works, which is the exact state the function was written to prevent.
 */
const clock: Clock = { now: () => new Date("2026-08-13T12:00:00Z") };

/** A settings row that is READY: open hours, an origin and one bookable service. */
const readyProps = (over: Partial<OrgSettingsProps> = {}): OrgSettingsProps =>
  baseSettingsProps({
    frontDesk: false,
    serviceOriginAddress: "02189",
    booking: {
      ...baseSettingsProps().booking,
      services: [{ name: "Drain cleaning", lane: "flat", price: 189, triggers: "" }],
    },
    ...over,
  });

const repoFor = (props: OrgSettingsProps) => {
  const saved: OrgSettings[] = [];
  const built = OrgSettings.create(props);
  if (!built.ok) throw new Error("fixture is not a valid OrgSettings");
  return {
    saved,
    getConfig: async () => built.value,
    saveConfig: async (s: OrgSettings) => void saved.push(s),
    hasConfig: async () => true,
  };
};

const run = (props: OrgSettingsProps, cmd: Record<string, unknown>) => {
  const repo = repoFor(props);
  // No geocoder: the origin is never re-geocoded in these cases, and a miss must not fail a save.
  return { repo, result: new UpdateConfigUseCase(repo as never, clock).exec(cmd as never, "org-1") };
};

describe("UpdateConfigUseCase — the front desk readiness gate", () => {
  it("refuses to switch the desk on when the service area is missing", async () => {
    const { repo, result } = run(readyProps({ serviceOriginAddress: null }), { frontDesk: true });
    const r = await result;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("precondition");
    // And nothing was written — a refused save must not half-apply the rest of the patch.
    expect(repo.saved).toHaveLength(0);
  });

  it("names what is missing, in the shop's words, not a gap key", async () => {
    const { result } = run(readyProps({ serviceOriginAddress: null }), { frontDesk: true });
    const r = await result;
    if (r.ok) throw new Error("expected a refusal");
    expect(r.error.message).toContain("your service area");
    expect(r.error.message).not.toContain("serviceArea");
  });

  it("joins several missing pieces into one sentence", async () => {
    const bare = readyProps({
      serviceOriginAddress: null,
      booking: { ...baseSettingsProps().booking, services: [] },
    });
    const { result } = run(bare, { frontDesk: true });
    const r = await result;
    if (r.ok) throw new Error("expected a refusal");
    expect(r.error.message).toContain("your service area and at least one bookable service");
  });

  it("allows the switch once the row is ready", async () => {
    const { repo, result } = run(readyProps(), { frontDesk: true });
    const r = await result;
    expect(r.ok).toBe(true);
    expect(repo.saved[0]?.props.frontDesk).toBe(true);
  });

  it("judges the RESULT, so one save can supply the gap AND turn the desk on", async () => {
    // The shop should not have to save twice: type the service area, flip the switch, one Save.
    const { repo, result } = run(readyProps({ serviceOriginAddress: null }), {
      frontDesk: true,
      serviceOriginAddress: "02189",
    });
    const r = await result;
    expect(r.ok).toBe(true);
    expect(repo.saved[0]?.props.frontDesk).toBe(true);
  });

  it("NEVER blocks switching the desk off", async () => {
    // An unready shop that is somehow on — the live Timepass state — must always be able to stop
    // answering. Gating the off-switch would trap it answering badly.
    const stuck = readyProps({ frontDesk: true, serviceOriginAddress: null });
    const { repo, result } = run(stuck, { frontDesk: false });
    const r = await result;
    expect(r.ok).toBe(true);
    expect(repo.saved[0]?.props.frontDesk).toBe(false);
  });

  it("does NOT trap a shop that is already on while unready", async () => {
    // The live Timepass state: switched on, no service area. Gating every save (rather than the
    // transition) would leave it unable to change its tax rate, its hours — anything at all —
    // while still answering badly. This is the case the first cut of the gate got wrong, and the
    // existing update-config tests caught it.
    const stuck = readyProps({ frontDesk: true, serviceOriginAddress: null });
    const { repo, result } = run(stuck, { taxBps: 625 });
    const r = await result;
    expect(r.ok).toBe(true);
    expect(repo.saved[0]?.props.taxBps).toBe(625);
    expect(repo.saved[0]?.props.frontDesk).toBe(true);
  });

  it("leaves an unrelated save alone on an unready row", async () => {
    // Editing the tax rate on a shop that has not finished setup must not be refused.
    const { repo, result } = run(readyProps({ serviceOriginAddress: null }), { taxBps: 625 });
    const r = await result;
    expect(r.ok).toBe(true);
    expect(repo.saved[0]?.props.taxBps).toBe(625);
  });
});
