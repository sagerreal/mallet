/**
 * features/a2p/sms-copy.ts
 * Every sentence the app says about texting not being switched on yet — in one file, because
 * there are two readers of the same fact and they must not drift into two vocabularies.
 *
 * THE OFFICE AND THE FIELD DO NOT GET THE SAME WORDS, and that is not a style choice.
 * `a2p.getStatus` is `ownerOrOffice`, so the four registration states exist only on the desk.
 * A technician's surfaces have one boolean — `canText` on `settings.fieldToggles` — so a field
 * sentence has to be true in ALL of not_started, pending and failed at once. "Texting isn't set
 * up" is not: it is a lie to a crew whose shop submitted last night and is waiting on a carrier.
 *
 * WHY NOT WIDEN THE FIELD READ. A technician cannot file a 10DLC registration, cannot read the
 * carrier's rejection reason, and can do nothing with either. Putting the shop's paperwork state
 * on their phone buys nothing and leaks the business's compliance status to the whole crew.
 */

/** Still fetching. States the wait, promises nothing, blames nobody. */
export const SMS_CHECKING_NOTE = "Checking texting setup…";

/**
 * No registration row at all — the owner or office has a task.
 *
 * WHAT IS AND IS NOT LOST. Reminders, receipts and booking confirmations still send: they ride
 * Mallet's shared line until the shop has its own. What needs the shop's OWN number is the
 * back-and-forth — a shared line belongs to no shop, so a customer's reply has no thread to land
 * in. Saying "quotes, reminders and invoices can go by email until it is" was true for one day and
 * is now simply wrong; those go by TEXT.
 */
export const SMS_NOT_SET_UP_NOTE = "Texting isn't set up yet.";
export const SMS_NOT_SET_UP_DETAIL =
  "Texting isn't set up yet. Reminders and receipts still send, but you can't message customers back and forth until it is.";

/**
 * Submitted, waiting on the carrier. NOBODY has a task here, which is the whole reason this
 * state is separate: the single old message sent a shop that had already finished registering
 * back to Settings to finish registering.
 *
 * The number is 5–7 business days because that is what the 10DLC process actually takes. The
 * Settings card used to promise "usually same day", which no shop has ever experienced.
 */
export const SMS_PENDING_NOTE = "Texting is being approved.";
export const SMS_PENDING_DETAIL =
  "Texting is being approved. Usually 5–7 business days — it switches on by itself. Reminders and receipts send in the meantime.";

/** The carrier refused. The reason is theirs and is shown verbatim when we have one. */
export const SMS_FAILED_NOTE = "Texting was rejected.";
export const SMS_FAILED_FALLBACK_DETAIL =
  "Texting was rejected. Open Settings for what the carrier said.";

/**
 * The one sentence the field gets, true in every state where the shop cannot message a customer.
 * Says "message", not "send texts": automated messages DO go out on the shared line — what the
 * technician cannot do is hold a conversation.
 */
export const SMS_FIELD_NOTE = "This shop can't message customers yet. The office sets that up.";

/**
 * Where the fix lives. The hash targets the Texting card's own anchor rather than dropping the
 * owner at the top of a long Settings page to go hunting for it.
 */
export const SMS_SETTINGS_HREF = "/settings#texting";
export const SMS_SETUP_LABEL = "Set up texting";
export const SMS_FIX_LABEL = "Fix registration";
