// Starter booking playbooks per ICP trade — seeded at onboarding so a new shop's AI front desk
// can route calls on day one instead of starting from a blank services list. Owners edit freely
// after seeding; these are starting points, not gospel.
//
// Content rules (enforced by trade-playbooks.test.ts):
//   - lanes only ever "repair" | "estimate" | "flat" via the Book-it/Quote-first model
//     (here: repair = book it priced on site, estimate = quote first; NO flat seeds — prices
//     are the owner's, never ours)
//   - NO dollar amounts anywhere (triggers/emergency words are interpolated into the prompt;
//     the price guardrail redacts them, so a seeded "$" would just get stripped)
//   - emergency words ONLY on bookable (repair-lane) services — quote-first jobs are not
//     same-day emergencies. Gas is NEVER an emergency word (gas leak = the 911 rule).

import type { BookingService } from "@/lib/store/slices/settings-slice";

export interface TradePlaybook {
  key: string;
  label: string;
  services: BookingService[];
}

const svc = (
  name: string,
  lane: BookingService["lane"],
  triggers: string,
  emergencyTriggers?: string,
): BookingService => ({ name, lane, triggers, ...(emergencyTriggers ? { emergencyTriggers } : {}) });

export const TRADE_PLAYBOOKS: readonly TradePlaybook[] = [
  {
    key: "plumbing",
    label: "Plumbing",
    services: [
      svc("Leak repair", "repair", "leak, dripping, pipe leaking, water damage",
        "burst pipe, flooding, water everywhere, sewage backup"),
      svc("Drain cleaning", "repair", "clogged drain, slow drain, backed up, snake"),
      svc("Water heater repair", "repair", "no hot water, pilot light out, water heater leaking"),
      svc("Toilet & fixture repair", "repair", "running toilet, won't flush, faucet, garbage disposal"),
      svc("Water heater replacement", "estimate", "replace water heater, tankless, old heater died"),
      svc("Repipe / larger job", "estimate", "repipe, whole house, low pressure everywhere, remodel"),
    ],
  },
  {
    key: "garage_door",
    label: "Garage door",
    services: [
      svc("Door repair", "repair", "won't open, won't close, stuck, off track, crooked",
        "car stuck inside, vehicle trapped, door won't close overnight, came off the tracks"),
      svc("Spring & cable replacement", "repair", "spring broke, loud bang, cable snapped, door heavy"),
      svc("Opener repair", "repair", "opener not working, remote, keypad, motor runs but door won't move"),
      svc("New door / replacement", "estimate", "new door, replace door, panel damage, upgrade"),
    ],
  },
  {
    key: "electrical",
    label: "Electrical",
    services: [
      svc("Electrical repair", "repair", "outlet dead, switch broken, breaker tripping, flickering",
        "sparking, burning smell, smoke from outlet, whole house lost power"),
      svc("Panel & breaker work", "repair", "panel, breaker box, fuses, upgrade panel"),
      svc("Lighting & fixtures", "repair", "light fixture, ceiling fan, recessed lights, install"),
      svc("Rewiring / larger job", "estimate", "rewire, whole house, remodel wiring, EV charger"),
    ],
  },
  {
    key: "tree",
    label: "Tree service",
    services: [
      svc("Storm / hazard work", "repair", "tree fell, hanging limb, leaning after storm",
        "tree on the house, tree on a car, limb about to fall, blocking the driveway"),
      svc("Stump grinding", "repair", "stump, grind stump, remove stump"),
      svc("Tree removal", "estimate", "remove tree, take down tree, dead tree"),
      svc("Trimming & pruning", "estimate", "trim, prune, branches over the roof, thin out"),
    ],
  },
  {
    key: "roofing",
    label: "Roofing (repair)",
    services: [
      svc("Leak repair", "repair", "roof leak, water coming in, ceiling stain, drip",
        "actively leaking, raining inside, needs a tarp today"),
      svc("Shingle & flashing repair", "repair", "missing shingles, flashing, wind damage, blown off"),
      svc("Roof inspection", "repair", "inspection, check the roof, buying a house"),
      svc("Roof replacement", "estimate", "new roof, replace roof, re-roof, how much for a roof"),
    ],
  },
  {
    key: "hvac",
    label: "HVAC",
    services: [
      svc("AC repair", "repair", "AC not working, not cooling, blowing warm air",
        "no cooling in a heat wave, elderly person with no AC"),
      svc("Heating repair", "repair", "furnace not working, no heat, blowing cold air",
        "no heat and freezing, furnace out in winter"),
      svc("Tune-up / maintenance", "repair", "tune up, seasonal service, check up, filter"),
      svc("System replacement", "estimate", "replace the system, new AC, new furnace, heat pump"),
    ],
  },
  {
    key: "septic",
    label: "Septic",
    services: [
      svc("Septic repair", "repair", "septic problem, alarm going off, smell, gurgling",
        "sewage backing up, overflowing, sewage in the yard"),
      svc("Septic pumping", "repair", "pump, pump out, tank full, haven't pumped in years"),
      svc("Septic inspection", "repair", "inspection, real estate, point of sale, certification"),
      svc("Drain field / larger job", "estimate", "drain field, leach field, replace the system"),
    ],
  },
  {
    key: "handyman",
    label: "Handyman",
    services: [
      svc("General repairs", "repair", "fix, repair, broken, odd jobs, small job",
        "door won't lock, broken window, can't secure the house"),
      svc("Drywall & paint", "repair", "drywall, hole in the wall, patch, paint a room"),
      svc("Assembly & mounting", "repair", "assemble furniture, mount a TV, hang shelves"),
      svc("Larger project", "estimate", "remodel, project, list of jobs, come look at it"),
    ],
  },
  {
    key: "appliance",
    label: "Appliance repair",
    services: [
      svc("Appliance repair", "repair", "not working, broken, won't start, error code",
        "leaking everywhere, flooding the kitchen, sparking"),
      svc("Refrigerator repair", "repair", "fridge, freezer, not cooling, warm inside"),
      svc("Washer & dryer repair", "repair", "washer, dryer, won't spin, won't drain, no heat"),
      svc("Installation", "estimate", "install, hook up, new appliance, dishwasher install"),
    ],
  },
  {
    key: "fencing",
    label: "Fencing",
    services: [
      svc("Fence & gate repair", "repair", "fix fence, leaning, broken panel, gate won't close",
        "fence down with a pool exposed, dog escaping, storm knocked it down"),
      svc("Staining & maintenance", "repair", "stain, seal, pressure wash, weathered"),
      svc("New fence", "estimate", "new fence, install fence, replace the whole fence"),
      svc("Gate & automation", "estimate", "new gate, automatic gate, driveway gate"),
    ],
  },
  {
    key: "other",
    label: "Other",
    services: [
      svc("Service call", "repair", "repair, fix, not working, broken, come take a look"),
      svc("Larger job — quote first", "estimate", "estimate, quote, big job, project, how much"),
    ],
  },
] as const;

export function playbookFor(key: string): TradePlaybook | undefined {
  return TRADE_PLAYBOOKS.find((t) => t.key === key);
}
