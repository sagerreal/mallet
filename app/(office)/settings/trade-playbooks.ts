// Starter booking playbooks per ICP trade — seeded at onboarding so a new shop's AI front desk
// can route calls on day one instead of starting from a blank services list. Owners edit freely
// after seeding; these are starting points, not gospel.
//
// Content rules (enforced by trade-playbooks.test.ts):
//   - lanes only ever "estimate" (fee or free) — flat is never seeded, prices are the owner's
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

/**
 * Playbook lanes are TWO since the flat-rate/estimate rework: every playbook entry is an
 * "estimate" booking (someone goes to look), differing only by whether the org's visit fee
 * applies. What was the "repair" lane — book it, tech prices on site — is `fee(...)` now: the
 * same estimate booking with the fee attached and the caller told so. No flat seeds, ever:
 * prices are the owner's, never ours.
 */
const svc = (
  name: string,
  triggers: string,
  emergencyTriggers?: string,
): BookingService => ({ name, lane: "estimate", triggers, ...(emergencyTriggers ? { emergencyTriggers } : {}) });

const fee = (
  name: string,
  triggers: string,
  emergencyTriggers?: string,
): BookingService => ({ ...svc(name, triggers, emergencyTriggers), feeApplies: true });

export const TRADE_PLAYBOOKS: readonly TradePlaybook[] = [
  {
    key: "hvac",
    label: "HVAC",
    services: [
      fee("AC repair", "AC not working, not cooling, blowing warm air",
        "no cooling in a heat wave, elderly person with no AC"),
      fee("Heating repair", "furnace not working, no heat, blowing cold air",
        "no heat and freezing, furnace out in winter"),
      fee("Tune-up / maintenance", "tune up, seasonal service, check up, filter"),
      svc("System replacement", "replace the system, new AC, new furnace, heat pump"),
    ],
  },
  {
    key: "mechanical",
    label: "Mechanical",
    services: [
      fee("Refrigeration repair", "walk-in, cooler, freezer, not holding temp, warm case",
        "walk-in down, product thawing, losing stock, freezer failed"),
      fee("Boiler & hydronic repair", "boiler, no heat, pressure dropping, hydronic, radiator",
        "boiler down, no heat in the building, tenants with no heat"),
      fee("Preventive maintenance", "pm, service contract, quarterly service, filters, coil cleaning"),
      svc("Equipment replacement", "replace the unit, new rooftop unit, retrofit, add capacity"),
    ],
  },
  {
    key: "electrical",
    label: "Electrical",
    services: [
      fee("Electrical repair", "outlet dead, switch broken, breaker tripping, flickering",
        "sparking, burning smell, smoke from outlet, whole house lost power"),
      fee("Panel & breaker work", "panel, breaker box, fuses, upgrade panel"),
      fee("Lighting & fixtures", "light fixture, ceiling fan, recessed lights, install"),
      svc("Rewiring / larger job", "rewire, whole house, remodel wiring, EV charger"),
    ],
  },
  {
    key: "plumbing",
    label: "Plumbing",
    services: [
      fee("Leak repair", "leak, dripping, pipe leaking, water damage",
        "burst pipe, flooding, water everywhere, sewage backup"),
      fee("Drain cleaning", "clogged drain, slow drain, backed up, snake"),
      fee("Water heater repair", "no hot water, pilot light out, water heater leaking"),
      fee("Toilet & fixture repair", "running toilet, won't flush, faucet, garbage disposal"),
      svc("Water heater replacement", "replace water heater, tankless, old heater died"),
      svc("Repipe / larger job", "repipe, whole house, low pressure everywhere, remodel"),
    ],
  },
  {
    key: "roofing",
    label: "Roofing",
    services: [
      fee("Leak repair", "roof leak, water coming in, ceiling stain, drip",
        "actively leaking, raining inside, needs a tarp today"),
      fee("Shingle & flashing repair", "missing shingles, flashing, wind damage, blown off"),
      fee("Roof inspection", "inspection, check the roof, buying a house"),
      svc("Roof replacement", "new roof, replace roof, re-roof, how much for a roof"),
    ],
  },
  {
    key: "painting",
    label: "Painting",
    services: [
      fee("Drywall repair & touch-up", "hole in the wall, patch, scuff, nail pops, touch up"),
      svc("Interior painting", "paint a room, repaint inside, walls, ceilings, whole interior"),
      svc("Exterior painting", "paint the house, exterior, trim, peeling, repaint outside"),
      svc("Cabinet refinishing", "cabinets, refinish, respray, kitchen cabinets"),
    ],
  },
  {
    key: "fencing",
    label: "Fencing",
    services: [
      fee("Fence & gate repair", "fix fence, leaning, broken panel, gate won't close",
        "fence down with a pool exposed, dog escaping, storm knocked it down"),
      fee("Staining & maintenance", "stain, seal, pressure wash, weathered"),
      svc("New fence", "new fence, install fence, replace the whole fence"),
      svc("Gate & automation", "new gate, automatic gate, driveway gate"),
    ],
  },
  {
    key: "concrete",
    label: "Concrete & flatwork",
    services: [
      fee("Concrete repair", "cracked, crumbling, uneven, spalling, trip hazard",
        "someone tripped, slab dropped, unsafe step at a business"),
      fee("Sealing & resurfacing", "seal, resurface, stamped, restore, pressure wash"),
      svc("Driveway & flatwork", "driveway, patio, walkway, slab, pour, sidewalk"),
      svc("Foundation & retaining walls", "foundation, footing, retaining wall, structural"),
    ],
  },
  {
    key: "siding",
    label: "Siding",
    services: [
      fee("Siding repair", "loose siding, missing panels, cracked, woodpecker, dented",
        "siding blown off, wall exposed, water getting behind it"),
      fee("Trim, soffit & fascia", "trim, soffit, fascia, rotted, wrap"),
      svc("Siding replacement", "new siding, replace siding, re-side, whole house"),
      fee("Storm & insurance inspection", "storm damage, hail, insurance, adjuster, inspection"),
    ],
  },
  {
    key: "gutters",
    label: "Gutters",
    services: [
      fee("Gutter cleaning", "clogged, overflowing, leaves, full of debris, cleaning"),
      fee("Gutter repair", "sagging, leaking, pulled away, downspout, loose",
        "gutter came down, water pouring against the foundation, hanging off the house"),
      svc("Gutter replacement", "new gutters, replace gutters, seamless, whole house"),
      svc("Guards & covers", "gutter guards, leaf guards, covers, screens"),
    ],
  },
  {
    key: "other",
    label: "Other",
    services: [
      fee("Service call", "repair, fix, not working, broken, come take a look"),
      svc("Larger job — quote first", "estimate, quote, big job, project, how much"),
    ],
  },
] as const;

export function playbookFor(key: string): TradePlaybook | undefined {
  return TRADE_PLAYBOOKS.find((t) => t.key === key);
}

/**
 * The trade keys as a zod-ready tuple, so a router validates against the real list rather than
 * accepting free text. A trade nothing in the app knows about seeds no playbook and no pricebook,
 * which would look to the shop like the question did nothing.
 */
export const TRADE_KEYS = TRADE_PLAYBOOKS.map((t) => t.key) as unknown as [string, ...string[]];
