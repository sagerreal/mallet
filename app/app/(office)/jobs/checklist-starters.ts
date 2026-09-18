// Starter "before-you-leave" checklists per ICP trade — seeded at onboarding so a new shop's
// checklist library isn't a blank page. Owners edit freely after seeding; these are starting
// points, not gospel.
//
// Content rules (enforced by checklist-starters.test.ts):
//   - photo items go on the steps that actually cause CALLBACKS / protect the shop
//     (water-heater → expansion tank + T&P discharge; AC → condensate line; etc.)
//   - check items for routine confirmations (cleaned, tested, customer walkthrough, etc.)
//   - NO dollar amounts / "$" tokens anywhere (same authorship hygiene as trade-playbooks)
//   - every trade's FIRST (flagship) checklist must have ≥1 photo item
//   - 3–12 items per checklist; ≤50 total items per checklist; unique names within a trade
//   - "other" = a generic pair so any business gets a usable starting point

export interface StarterChecklistItem {
  readonly text: string;
  readonly type: "check" | "photo";
}

export interface StarterChecklist {
  readonly name: string;
  readonly items: readonly StarterChecklistItem[];
}

export interface ChecklistStarterSet {
  readonly key: string;
  readonly label: string;
  readonly checklists: readonly StarterChecklist[];
}

export const CHECKLIST_STARTERS: readonly ChecklistStarterSet[] = [
  {
    key: "hvac",
    label: "HVAC",
    checklists: [
      {
        name: "AC repair",
        items: [
          { text: "Photo of the clear condensate drain line — no blockage, draining freely", type: "photo" },
          { text: "Photo of the refrigerant port caps reinstalled and secured", type: "photo" },
          { text: "Confirm system reaches setpoint within 15 minutes of startup", type: "check" },
          { text: "Check supply and return static pressure — within spec", type: "check" },
          { text: "Inspect air filter and replace if restricted", type: "check" },
          { text: "Inspect condensate pan — no standing water", type: "check" },
          { text: "Confirm no refrigerant odor or visible leaks at service ports", type: "check" },
          { text: "Log high and low side pressures", type: "check" },
          { text: "Customer walkthrough — confirm comfort and thermostat operation", type: "check" },
        ],
      },
      {
        name: "Heating repair",
        items: [
          { text: "Photo of the completed heat exchanger inspection or burner assembly", type: "photo" },
          { text: "Confirm system reaches setpoint within 20 minutes of startup", type: "check" },
          { text: "Verify ignition cycle and confirm no lockouts", type: "check" },
          { text: "Check flue and venting for obstruction or back-draft", type: "check" },
          { text: "Inspect air filter and replace if restricted", type: "check" },
          { text: "Test CO detector in the area — note reading", type: "check" },
          { text: "Customer walkthrough — confirm heat at all registers", type: "check" },
        ],
      },
      {
        name: "Tune-up and maintenance",
        items: [
          { text: "Photo of the cleaned coils — before and after if heavily fouled", type: "photo" },
          { text: "Replace air filter and note size for customer records", type: "check" },
          { text: "Clean condenser and evaporator coils", type: "check" },
          { text: "Flush condensate drain line", type: "check" },
          { text: "Inspect blower wheel and motor", type: "check" },
          { text: "Test capacitors and contactors", type: "check" },
          { text: "Check refrigerant charge — note high and low side pressures", type: "check" },
          { text: "Lubricate all motors as applicable", type: "check" },
          { text: "Test thermostat calibration", type: "check" },
          { text: "Customer walkthrough — review findings and next service date", type: "check" },
        ],
      },
      {
        name: "System replacement",
        items: [
          { text: "Photo of the completed outdoor unit installation — pad level, clearances visible", type: "photo" },
          { text: "Photo of the completed air handler or furnace installation", type: "photo" },
          { text: "Photo of refrigerant line set connections and insulation", type: "photo" },
          { text: "Confirm system achieves setpoint on first call", type: "check" },
          { text: "Check all supply and return registers for proper airflow", type: "check" },
          { text: "Flush and clear condensate drain", type: "check" },
          { text: "Record model and serial numbers for warranty registration", type: "check" },
          { text: "Old equipment removed from premises", type: "check" },
          { text: "Customer walkthrough — explain thermostat, filter location, and warranty", type: "check" },
        ],
      },
    ],
  },
  {
    key: "mechanical",
    label: "Mechanical",
    checklists: [
      {
        name: "Refrigeration service",
        items: [
          { text: "Suction and discharge pressures at the gauge set", type: "photo" },
          { text: "Box temperature once it has pulled back down", type: "photo" },
          { text: "Superheat and subcool recorded", type: "check" },
          { text: "Condenser coil cleaned", type: "check" },
          { text: "Defrost cycle verified", type: "check" },
          { text: "Door gaskets and closer checked", type: "check" },
          { text: "Readings shown to the customer before leaving", type: "check" },
        ],
      },
      {
        name: "Boiler service",
        items: [
          { text: "Combustion analyser readings", type: "photo" },
          { text: "Flue and venting condition", type: "photo" },
          { text: "Low-water cutoff tested", type: "check" },
          { text: "Relief valve inspected", type: "check" },
          { text: "Expansion tank pressure checked", type: "check" },
          { text: "System pressure and temperature logged", type: "check" },
        ],
      },
    ],
  },
  {
    key: "electrical",
    label: "Electrical",
    checklists: [
      {
        name: "Panel and breaker work",
        items: [
          { text: "Photo of the labeled panel directory — all breakers identified", type: "photo" },
          { text: "Photo of torqued lugs and wire terminations inside the panel", type: "photo" },
          { text: "Confirm all breakers seat fully and none are in a tripped state", type: "check" },
          { text: "Test each affected circuit with a known load", type: "check" },
          { text: "Verify ground and neutral bars are secure and properly landed", type: "check" },
          { text: "No exposed conductors or open knockouts remaining", type: "check" },
          { text: "Panel cover reinstalled and secured", type: "check" },
          { text: "Area cleaned — no wire scraps or debris inside panel", type: "check" },
          { text: "Customer walkthrough — show new breaker locations and how to reset", type: "check" },
        ],
      },
      {
        name: "Outlet and switch repair",
        items: [
          { text: "Photo of the completed outlet or switch before the cover plate goes on", type: "photo" },
          { text: "Test outlet with a plug-in tester — confirm hot, neutral, ground correct", type: "check" },
          { text: "Confirm GFCI protection is present where required (kitchen, bath, exterior)", type: "check" },
          { text: "Cover plate installed and seated flush", type: "check" },
          { text: "Customer walkthrough completed", type: "check" },
        ],
      },
      {
        name: "Lighting and fixture installation",
        items: [
          { text: "Photo of the installed fixture — fully seated and trim flush", type: "photo" },
          { text: "Turn fixture on for five minutes and confirm no flicker or heat issues", type: "check" },
          { text: "Confirm dimmer compatibility if applicable", type: "check" },
          { text: "Canopy or trim ring seated flush against ceiling or wall", type: "check" },
          { text: "Old fixture and packaging removed from premises", type: "check" },
          { text: "Customer walkthrough — show switch location and dimmer range", type: "check" },
        ],
      },
      {
        name: "Rewire and larger job",
        items: [
          { text: "Photo of the completed rough-in or final wiring before cover", type: "photo" },
          { text: "Photo of the updated panel label showing new circuits", type: "photo" },
          { text: "All circuits tested with a load", type: "check" },
          { text: "Inspect all junction boxes are covered", type: "check" },
          { text: "GFCI and AFCI breakers verified where required by code", type: "check" },
          { text: "All penetrations fire-blocked and sealed", type: "check" },
          { text: "Area cleaned and tools removed", type: "check" },
          { text: "Customer walkthrough — explain each new circuit", type: "check" },
        ],
      },
    ],
  },
  {
    key: "plumbing",
    label: "Plumbing",
    checklists: [
      {
        name: "Water heater replacement",
        items: [
          { text: "Photo of the expansion tank installed and pressurized", type: "photo" },
          { text: "Photo of the T&P discharge line routed to within 6 inches of the floor or drain", type: "photo" },
          { text: "Photo of the completed gas or electrical connection", type: "photo" },
          { text: "Set thermostat to 120°F and verify setting on the unit", type: "check" },
          { text: "Open a hot-water fixture and confirm flow — purge air from the lines", type: "check" },
          { text: "Inspect all connections for drips at full operating pressure", type: "check" },
          { text: "Old unit drained and removed from the premises", type: "check" },
          { text: "Area cleaned and floor dry", type: "check" },
          { text: "Customer walkthrough completed — show shutoff location and thermostat", type: "check" },
        ],
      },
      {
        name: "Leak repair",
        items: [
          { text: "Photo of the completed repair before concealing", type: "photo" },
          { text: "Run water for 5 minutes and inspect the repair for any seepage", type: "check" },
          { text: "Restore water pressure to full and re-inspect", type: "check" },
          { text: "Check adjacent fittings for hidden corrosion", type: "check" },
          { text: "Dry and wipe down the work area", type: "check" },
          { text: "Customer walkthrough — confirm no remaining leak signs", type: "check" },
        ],
      },
      {
        name: "Drain cleaning",
        items: [
          { text: "Run water for 2 minutes and confirm drain flows freely", type: "check" },
          { text: "Test all fixtures on the same drain line", type: "check" },
          { text: "Check p-trap and clean-out cap are seated and sealed", type: "check" },
          { text: "Wipe down sink and surrounding area", type: "check" },
          { text: "Customer advised of preventive measures", type: "check" },
        ],
      },
      {
        name: "Toilet and fixture repair",
        items: [
          { text: "Flush toilet three times and confirm it seats and seals properly", type: "check" },
          { text: "Check wax ring area and base for moisture", type: "check" },
          { text: "Inspect supply line and shutoff valve for drips", type: "check" },
          { text: "Wipe down toilet and surrounding floor", type: "check" },
          { text: "Customer walkthrough completed", type: "check" },
        ],
      },
    ],
  },
  {
    key: "roofing",
    label: "Roofing",
    checklists: [
      {
        name: "Shingle and flashing repair",
        items: [
          { text: "Photo of the sealed flashing — step, valley, and counter flashing fully embedded", type: "photo" },
          { text: "Photo of the replaced shingle course — color match and nail pattern visible", type: "photo" },
          { text: "Walk the full repaired section and press all shingle tabs — no lifted edges", type: "check" },
          { text: "Inspect penetrations (vents, pipes, skylights) for gaps", type: "check" },
          { text: "Inspect ridge cap for displaced or cracked segments", type: "check" },
          { text: "Remove all debris, nails, and scraps from roof and ground", type: "check" },
          { text: "Customer walkthrough — explain what was replaced and what to watch for", type: "check" },
        ],
      },
      {
        name: "Leak repair",
        items: [
          { text: "Photo of the source area sealed — sealant applied and tooled", type: "photo" },
          { text: "Inspect attic space below the repair for moisture or staining", type: "check" },
          { text: "Run water test at the repair area for five minutes", type: "check" },
          { text: "Check interior ceiling for any active drip", type: "check" },
          { text: "All debris cleared from roof and gutters", type: "check" },
          { text: "Customer advised of interior drying time and any follow-up needed", type: "check" },
        ],
      },
      {
        name: "Roof inspection",
        items: [
          { text: "Photo of each roof face documenting condition", type: "photo" },
          { text: "Photo of any defects found — lifted shingles, cracked flashing, open seams", type: "photo" },
          { text: "Check all penetrations and flashing", type: "check" },
          { text: "Inspect ridge, hips, and valley conditions", type: "check" },
          { text: "Inspect gutters and downspouts for blockage and secure attachment", type: "check" },
          { text: "Check attic ventilation and look for signs of moisture or daylight", type: "check" },
          { text: "Customer walkthrough — review findings and next steps", type: "check" },
        ],
      },
    ],
  },
  {
    key: "painting",
    label: "Painting",
    checklists: [
      {
        name: "Interior repaint",
        items: [
          { text: "Room photographed before any prep", type: "photo" },
          { text: "Finished walls with the lights on", type: "photo" },
          { text: "Floors, fixtures and hardware masked", type: "check" },
          { text: "Patches sanded and spot-primed", type: "check" },
          { text: "Switch plates and hardware reinstalled", type: "check" },
          { text: "Touch-up paint labelled and left with the customer", type: "check" },
          { text: "Walkthrough done with the customer", type: "check" },
        ],
      },
      {
        name: "Exterior repaint",
        items: [
          { text: "Siding and trim condition before washing", type: "photo" },
          { text: "Finished elevations", type: "photo" },
          { text: "Surfaces washed and left to dry", type: "check" },
          { text: "Bare wood primed", type: "check" },
          { text: "Caulking renewed at trim and joints", type: "check" },
          { text: "Landscaping uncovered and site cleared", type: "check" },
        ],
      },
    ],
  },
  {
    key: "fencing",
    label: "Fencing",
    checklists: [
      {
        name: "Fence and gate repair",
        items: [
          { text: "Photo of the repaired section — post plumb and rails level", type: "photo" },
          { text: "Push and pull test on repaired panel — no movement at post", type: "check" },
          { text: "Gate swings freely and latches on first attempt", type: "check" },
          { text: "All fasteners and hardware tightened", type: "check" },
          { text: "Inspect adjacent panels for similar damage", type: "check" },
          { text: "Area cleaned — no debris or scrap left on property", type: "check" },
          { text: "Customer walkthrough — confirm repair and gate operation", type: "check" },
        ],
      },
      {
        name: "New fence installation",
        items: [
          { text: "Photo of the completed fence run — posts plumb and line consistent", type: "photo" },
          { text: "Photo of each gate in the closed and latched position", type: "photo" },
          { text: "Check post plumb at every other post along the run", type: "check" },
          { text: "Confirm all concrete footings are set and cured", type: "check" },
          { text: "Gate swings freely, self-latches, and is level", type: "check" },
          { text: "Screws and fasteners inspected — no exposed sharp ends", type: "check" },
          { text: "All scrap, packaging, and post trimmings removed from premises", type: "check" },
          { text: "Customer walkthrough — walk the fence line together", type: "check" },
        ],
      },
      {
        name: "Staining and maintenance",
        items: [
          { text: "Photo of the completed stain coat — even coverage, no blotchy sections", type: "photo" },
          { text: "Confirm stain is dry to touch before leaving — no transfer on finger", type: "check" },
          { text: "Inspect for any missed areas or drips on surrounding surfaces", type: "check" },
          { text: "Remove all masking, tape, and protective covers from adjacent surfaces", type: "check" },
          { text: "Customer advised of dry time before touching fence", type: "check" },
          { text: "Area cleaned and equipment removed", type: "check" },
        ],
      },
    ],
  },
  {
    key: "concrete",
    label: "Concrete & flatwork",
    checklists: [
      {
        name: "Pour day",
        items: [
          { text: "Subgrade and forms before the pour", type: "photo" },
          { text: "Reinforcement in place before concrete", type: "photo" },
          { text: "Finished surface after final trowel", type: "photo" },
          { text: "Delivery ticket checked against the mix ordered", type: "check" },
          { text: "Control joints cut at the planned spacing", type: "check" },
          { text: "Curing compound or covering applied", type: "check" },
          { text: "Customer told when they can walk and drive on it", type: "check" },
        ],
      },
      {
        name: "Concrete repair",
        items: [
          { text: "Damage before removal", type: "photo" },
          { text: "Repaired area finished", type: "photo" },
          { text: "Loose material removed back to sound concrete", type: "check" },
          { text: "Bonding agent applied", type: "check" },
          { text: "Site swept and debris removed", type: "check" },
        ],
      },
    ],
  },
  {
    key: "siding",
    label: "Siding",
    checklists: [
      {
        name: "Siding repair or replacement",
        items: [
          { text: "Existing damage before removal", type: "photo" },
          { text: "Sheathing and water barrier once exposed", type: "photo" },
          { text: "Finished elevation", type: "photo" },
          { text: "Flashing installed at windows and penetrations", type: "check" },
          { text: "Housewrap sealed and taped", type: "check" },
          { text: "Fasteners at the manufacturer's spacing", type: "check" },
          { text: "Site cleared and a magnet run for fasteners", type: "check" },
        ],
      },
      {
        name: "Storm damage inspection",
        items: [
          { text: "Each damaged elevation", type: "photo" },
          { text: "Close-up of representative damage", type: "photo" },
          { text: "Test square documented", type: "check" },
          { text: "Impact points marked", type: "check" },
          { text: "Findings reviewed with the homeowner", type: "check" },
        ],
      },
    ],
  },
  {
    key: "gutters",
    label: "Gutters",
    checklists: [
      {
        name: "Gutter install or replacement",
        items: [
          { text: "Fascia condition before hanging", type: "photo" },
          { text: "Water running through the finished system", type: "photo" },
          { text: "Hangers spaced to spec", type: "check" },
          { text: "Slope checked to every downspout", type: "check" },
          { text: "Downspouts discharging away from the foundation", type: "check" },
          { text: "Old gutters and debris removed from site", type: "check" },
        ],
      },
      {
        name: "Gutter cleaning",
        items: [
          { text: "Gutters before cleaning", type: "photo" },
          { text: "Gutters after cleaning", type: "photo" },
          { text: "Debris cleared from runs and downspouts", type: "check" },
          { text: "Downspouts flushed and flowing", type: "check" },
          { text: "Roof and grounds cleared of debris", type: "check" },
        ],
      },
    ],
  },
  {
    key: "other",
    label: "Other",
    checklists: [
      {
        name: "Service call",
        items: [
          { text: "Photo of the completed repair or installation", type: "photo" },
          { text: "Test the repaired item — confirm it functions as expected", type: "check" },
          { text: "Area cleaned and tools removed from the premises", type: "check" },
          { text: "Customer walkthrough — confirm satisfaction with the work", type: "check" },
        ],
      },
      {
        name: "Larger job",
        items: [
          { text: "Photo of all completed work areas", type: "photo" },
          { text: "Test all installed or repaired items", type: "check" },
          { text: "Walk the full scope with the customer and address any questions", type: "check" },
          { text: "All tools, materials, and debris removed from the premises", type: "check" },
          { text: "Punch list reviewed — any open items documented and communicated", type: "check" },
          { text: "Customer confirms work is complete and acceptable", type: "check" },
        ],
      },
    ],
  },
] as const;

export function checklistStartersFor(key: string): ChecklistStarterSet | undefined {
  return CHECKLIST_STARTERS.find((s) => s.key === key);
}
