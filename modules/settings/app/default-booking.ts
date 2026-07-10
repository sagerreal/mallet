import type { BookingCfg } from "../domain/org-settings";

// First-run defaults for a brand-new org. Ported verbatim from the prototype's SEED_BOOKING so a
// fresh workspace opens with a usable booking playbook rather than an empty screen.
export const defaultBooking = (): BookingCfg => ({
  services: [
    { name: "Water heater repair", lane: "repair", triggers: "leaking, no hot water, pilot out, rusty water, water heater not working" },
    { name: "Water heater replacement", lane: "estimate", triggers: "replace water heater, new water heater, tankless install, old one died" },
    { name: "AC / heating repair", lane: "repair", triggers: "not cooling, warm air, no heat, ac stopped, furnace, no power" },
    { name: "AC / system replacement", lane: "estimate", triggers: "replace my whole, new system, replace my ac, new ac unit" },
    { name: "Drain cleaning", lane: "flat", price: 99, triggers: "drain cleaning, clogged, slow drain, backed up, snake" },
    { name: "Sewer camera inspection", lane: "flat", price: 285, triggers: "sewer camera, camera inspection, locate the line" },
    { name: "Leak detection & repair", lane: "repair", triggers: "leak, dripping, water damage" },
    { name: "Toilet & fixture install", lane: "repair", triggers: "running toilet, leaking toilet, wont flush, faucet" },
    { name: "Whole-house repipe / re-pipe", lane: "estimate", triggers: "repipe, re-pipe, galvanized, whole house repipe, low pressure everywhere, old pipes" },
  ],
  notServices: "New construction · septic · well pumps",
  serviceFee: 89,
  feeCredited: true,
});
