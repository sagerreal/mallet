/**
 * features/jobs/schedule-constants.ts
 * Layout + capacity constants for the schedule board. Named so the geometry is
 * legible and tunable in one place (was scattered magic numbers).
 */

/** Board horizontal scale: pixels per hour column. */
export const SCHEDULE_PX_PER_HOUR = 78;
/** A crew's daily capacity, in hours (drives the load meter). */
export const CREW_CAPACITY_HOURS = 8;
/** Load ≥ this fraction of capacity reads as "full" (amber). */
export const CREW_FULL_THRESHOLD = 0.8;
/** Default business-hours window when a day has no visits yet. */
export const BUSINESS_HOURS: { open: number; close: number } = { open: 8, close: 17 };
/** Visit durations snap to the quarter hour. */
export const QUARTER_HOUR = 0.25;
/** A visit can never be shorter than this. */
export const MIN_VISIT_DURATION = 0.25;
/** A placed block never renders narrower than this, minus padding. */
export const MIN_BLOCK_WIDTH_PX = 38;
export const BLOCK_GAP_PX = 4;
/** Completed visits dim to this opacity. */
export const DONE_VISIT_OPACITY = 0.55;
/** Board header + lane row heights. */
export const SCHEDULE_HEADER_HEIGHT_PX = 24;
export const SCHEDULE_LANE_HEIGHT_PX = 58;
/** To-schedule tray card min column width. */
export const TRAY_CARD_MIN_WIDTH_PX = 240;
