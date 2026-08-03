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
    key: "mechanical",
    label: "Mechanical",
    services: [
      svc("Refrigeration repair", "repair", "walk-in, cooler, freezer, not holding temp, warm case",
        "walk-in down, product thawing, losing stock, freezer failed"),
      svc("Boiler & hydronic repair", "repair", "boiler, no heat, pressure dropping, hydronic, radiator",
        "boiler down, no heat in the building, tenants with no heat"),
      svc("Preventive maintenance", "repair", "pm, service contract, quarterly service, filters, coil cleaning"),
      svc("Equipment replacement", "estimate", "replace the unit, new rooftop unit, retrofit, add capacity"),
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
    key: "roofing",
    label: "Roofing",
    services: [
      svc("Leak repair", "repair", "roof leak, water coming in, ceiling stain, drip",
        "actively leaking, raining inside, needs a tarp today"),
      svc("Shingle & flashing repair", "repair", "missing shingles, flashing, wind damage, blown off"),
      svc("Roof inspection", "repair", "inspection, check the roof, buying a house"),
      svc("Roof replacement", "estimate", "new roof, replace roof, re-roof, how much for a roof"),
    ],
  },
  {
    key: "painting",
    label: "Painting",
    services: [
      svc("Drywall repair & touch-up", "repair", "hole in the wall, patch, scuff, nail pops, touch up"),
      svc("Interior painting", "estimate", "paint a room, repaint inside, walls, ceilings, whole interior"),
      svc("Exterior painting", "estimate", "paint the house, exterior, trim, peeling, repaint outside"),
      svc("Cabinet refinishing", "estimate", "cabinets, refinish, respray, kitchen cabinets"),
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
    key: "concrete",
    label: "Concrete & flatwork",
    services: [
      svc("Concrete repair", "repair", "cracked, crumbling, uneven, spalling, trip hazard",
        "someone tripped, slab dropped, unsafe step at a business"),
      svc("Sealing & resurfacing", "repair", "seal, resurface, stamped, restore, pressure wash"),
      svc("Driveway & flatwork", "estimate", "driveway, patio, walkway, slab, pour, sidewalk"),
      svc("Foundation & retaining walls", "estimate", "foundation, footing, retaining wall, structural"),
    ],
  },
  {
    key: "siding",
    label: "Siding",
    services: [
      svc("Siding repair", "repair", "loose siding, missing panels, cracked, woodpecker, dented",
        "siding blown off, wall exposed, water getting behind it"),
      svc("Trim, soffit & fascia", "repair", "trim, soffit, fascia, rotted, wrap"),
      svc("Siding replacement", "estimate", "new siding, replace siding, re-side, whole house"),
      svc("Storm & insurance inspection", "repair", "storm damage, hail, insurance, adjuster, inspection"),
    ],
  },
  {
    key: "gutters",
    label: "Gutters",
    services: [
      svc("Gutter cleaning", "repair", "clogged, overflowing, leaves, full of debris, cleaning"),
      svc("Gutter repair", "repair", "sagging, leaking, pulled away, downspout, loose",
        "gutter came down, water pouring against the foundation, hanging off the house"),
      svc("Gutter replacement", "estimate", "new gutters, replace gutters, seamless, whole house"),
      svc("Guards & covers", "estimate", "gutter guards, leaf guards, covers, screens"),
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
