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
    key: "garage_door",
    label: "Garage door",
    checklists: [
      {
        name: "Spring and cable replacement",
        items: [
          { text: "Photo of the balanced door at rest — confirm it stays at mid-travel without holding", type: "photo" },
          { text: "Photo of the spring set and cable drums from both sides", type: "photo" },
          { text: "Test door balance: manually lift to mid-height and release — should hold within 2 inches", type: "check" },
          { text: "Cycle the door five times via opener and confirm smooth travel", type: "check" },
          { text: "Apply lubricant to springs, hinges, rollers, and cable drums", type: "check" },
          { text: "Test all safety reversal sensors — door reverses on obstruction", type: "check" },
          { text: "Confirm auto-close timer and wall button are functional", type: "check" },
          { text: "Confirm all hardware is torqued — no loose lag bolts or brackets", type: "check" },
          { text: "Customer walkthrough — demonstrate manual release cord", type: "check" },
        ],
      },
      {
        name: "Opener repair",
        items: [
          { text: "Photo of the opener power unit and wiring connections", type: "photo" },
          { text: "Cycle door five times with all remotes and the keypad", type: "check" },
          { text: "Confirm force limits are set correctly — door reverses on resistance", type: "check" },
          { text: "Confirm safety sensors are aligned (indicator lights solid)", type: "check" },
          { text: "Test wall control and confirm LED behavior", type: "check" },
          { text: "Customer walkthrough — reprogram any personal codes if needed", type: "check" },
        ],
      },
      {
        name: "Door repair",
        items: [
          { text: "Photo of the re-aligned door from the outside, closed position", type: "photo" },
          { text: "Cycle door manually and by opener — travels full range without binding", type: "check" },
          { text: "Inspect all rollers and track for damage", type: "check" },
          { text: "Tighten all hardware — brackets, bolts, hinges", type: "check" },
          { text: "Lubricate rollers, hinges, and tracks", type: "check" },
          { text: "Customer walkthrough completed", type: "check" },
        ],
      },
      {
        name: "New door installation",
        items: [
          { text: "Photo of the installed door, exterior view, closed", type: "photo" },
          { text: "Photo of the spring and hardware detail", type: "photo" },
          { text: "Test door balance at mid-height — holds within 2 inches", type: "check" },
          { text: "Cycle door ten times and confirm smooth operation", type: "check" },
          { text: "All safety reversal and sensor tests passed", type: "check" },
          { text: "Sweep seal and weather stripping seated flush", type: "check" },
          { text: "Old door and packaging removed from premises", type: "check" },
          { text: "Customer walkthrough — demonstrate emergency release and all remotes", type: "check" },
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
    key: "tree",
    label: "Tree service",
    checklists: [
      {
        name: "Tree removal",
        items: [
          { text: "Photo of the cleared stump area at ground level", type: "photo" },
          { text: "All sections limbed, bucked, and cleared from the work zone", type: "check" },
          { text: "Chip or remove all brush — no large debris left on site", type: "check" },
          { text: "Inspect property for any branches or debris outside the primary drop zone", type: "check" },
          { text: "Check roof, gutters, and fence lines for any debris that landed there", type: "check" },
          { text: "Customer walkthrough — confirm satisfaction before leaving", type: "check" },
          { text: "Equipment cleaned and moved off the property", type: "check" },
        ],
      },
      {
        name: "Storm and hazard work",
        items: [
          { text: "Photo of the hazard cleared and the area safe", type: "photo" },
          { text: "Confirm no hanging limbs (widowmakers) remain in the canopy", type: "check" },
          { text: "Remove all debris from roof, gutters, and driveway", type: "check" },
          { text: "Inspect fence, structures, and utilities for contact points", type: "check" },
          { text: "Customer advised of any remaining concerns that need follow-up work", type: "check" },
          { text: "Area cleaned and equipment off the property", type: "check" },
        ],
      },
      {
        name: "Trimming and pruning",
        items: [
          { text: "Photo of the completed crown — balanced silhouette from the property line", type: "photo" },
          { text: "All cut ends clean — no torn bark or ragged stubs", type: "check" },
          { text: "Branches cleared from roof clearance zone", type: "check" },
          { text: "All debris chipped or removed from the property", type: "check" },
          { text: "Customer walkthrough — confirm shape and clearances are acceptable", type: "check" },
        ],
      },
      {
        name: "Stump grinding",
        items: [
          { text: "Photo of the ground stump at or below grade", type: "photo" },
          { text: "Grind to at least 4 inches below grade or per customer request", type: "check" },
          { text: "Chip debris spread over the cavity or hauled per agreement", type: "check" },
          { text: "Area raked and left clean", type: "check" },
          { text: "Customer walkthrough — confirm depth and fill plan", type: "check" },
        ],
      },
    ],
  },
  {
    key: "roofing",
    label: "Roofing (repair)",
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
    key: "septic",
    label: "Septic",
    checklists: [
      {
        name: "Septic pumping",
        items: [
          { text: "Photo of the open tank after pumping — clean tank interior visible", type: "photo" },
          { text: "Confirm the tank is pumped to the inlet baffle", type: "check" },
          { text: "Inspect inlet and outlet baffles — intact and free of cracks", type: "check" },
          { text: "Check lid and riser seals — no gaps or cracks", type: "check" },
          { text: "Flush a toilet and confirm flow into tank is normal", type: "check" },
          { text: "Reseat and secure all lids and access covers", type: "check" },
          { text: "Area cleaned — no effluent residue on driveway or lawn", type: "check" },
          { text: "Customer advised of next recommended pump interval", type: "check" },
        ],
      },
      {
        name: "Septic repair",
        items: [
          { text: "Photo of the completed repair before backfill", type: "photo" },
          { text: "Run all fixtures for five minutes and inspect for alarms or backflow", type: "check" },
          { text: "Confirm alarm panel reset and all indicators green", type: "check" },
          { text: "Inspect lid seals and risers — all sealed", type: "check" },
          { text: "Area restored — disturbed ground raked and level", type: "check" },
          { text: "Customer walkthrough — explain what was repaired and signs to watch for", type: "check" },
        ],
      },
      {
        name: "Septic inspection",
        items: [
          { text: "Photo of the exposed tank lids and riser condition", type: "photo" },
          { text: "Photo of the inlet and outlet baffles", type: "photo" },
          { text: "Measure and record the scum and sludge layers", type: "check" },
          { text: "Inspect drain field surface for soft spots, odor, or effluent surfacing", type: "check" },
          { text: "Check distribution box for even flow to all laterals", type: "check" },
          { text: "Record tank size and date of last pumping", type: "check" },
          { text: "Customer walkthrough — explain findings and any recommendations", type: "check" },
        ],
      },
    ],
  },
  {
    key: "handyman",
    label: "Handyman",
    checklists: [
      {
        name: "General repairs",
        items: [
          { text: "Photo of each completed repair — before concealment or finishing", type: "photo" },
          { text: "Test each repaired item — confirm it functions correctly", type: "check" },
          { text: "Inspect adjacent areas for any issues noticed during work", type: "check" },
          { text: "Area cleaned and all debris removed", type: "check" },
          { text: "Customer walkthrough — walk through all completed items", type: "check" },
        ],
      },
      {
        name: "Drywall and paint",
        items: [
          { text: "Photo of the primed and painted repair — texture matched", type: "photo" },
          { text: "Confirm patch is fully dry and solid — no soft spots", type: "check" },
          { text: "Feathered paint edge — no visible line from a normal viewing distance", type: "check" },
          { text: "Dust cleaned from all surfaces in the work area", type: "check" },
          { text: "Drop cloths and tape removed — surfaces clean", type: "check" },
          { text: "Customer walkthrough — confirm finish and color acceptance", type: "check" },
        ],
      },
      {
        name: "Assembly and mounting",
        items: [
          { text: "Photo of the mounted item — level and anchored in the final position", type: "photo" },
          { text: "Pull-test the mount — confirm it holds under load", type: "check" },
          { text: "Confirm all fasteners are in studs or rated wall anchors", type: "check" },
          { text: "Level verified with a level or digital tool", type: "check" },
          { text: "Packaging and debris removed from premises", type: "check" },
          { text: "Customer walkthrough — confirm placement and satisfaction", type: "check" },
        ],
      },
      {
        name: "Larger project",
        items: [
          { text: "Photo of all completed work — all areas covered", type: "photo" },
          { text: "Test every installed or repaired item", type: "check" },
          { text: "All tools and materials removed from the premises", type: "check" },
          { text: "Area cleaned and restored to pre-work condition", type: "check" },
          { text: "Any punch-list items identified and noted for follow-up", type: "check" },
          { text: "Customer walkthrough — review entire scope", type: "check" },
        ],
      },
    ],
  },
  {
    key: "appliance",
    label: "Appliance repair",
    checklists: [
      {
        name: "Appliance repair",
        items: [
          { text: "Photo of the completed repair — component replaced or connection secured", type: "photo" },
          { text: "Run the appliance through a full cycle or test mode", type: "check" },
          { text: "Confirm no error codes present at end of cycle", type: "check" },
          { text: "Inspect all hose and electrical connections for proper seating", type: "check" },
          { text: "Appliance pushed back into position and level checked", type: "check" },
          { text: "Area cleaned and old parts removed from the premises", type: "check" },
          { text: "Customer walkthrough — demonstrate normal operation", type: "check" },
        ],
      },
      {
        name: "Refrigerator repair",
        items: [
          { text: "Photo of the repaired component — sealed evaporator, replaced fan, or compressor connection", type: "photo" },
          { text: "Confirm fresh food section reaches temp within 30 minutes of restart", type: "check" },
          { text: "Confirm freezer section is pulling down to setpoint", type: "check" },
          { text: "Inspect door gaskets — seal tight around the full perimeter", type: "check" },
          { text: "Check drain pan and evaporator drain line — clear and seated", type: "check" },
          { text: "Customer advised not to fully load fridge for four hours to allow stabilization", type: "check" },
        ],
      },
      {
        name: "Washer and dryer repair",
        items: [
          { text: "Photo of the repaired component — belt, pump, lid switch, or heating element", type: "photo" },
          { text: "Run a short wash cycle end-to-end — agitate, spin, drain confirmed", type: "check" },
          { text: "Check all hose connections for drips post-cycle", type: "check" },
          { text: "Inspect dryer vent for kinks or restrictions if dryer work was performed", type: "check" },
          { text: "Appliance level and anti-vibration pads seated", type: "check" },
          { text: "Customer walkthrough — explain repaired component and warranty if applicable", type: "check" },
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
