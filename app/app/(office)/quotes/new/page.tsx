/**
 * /quotes/new — retired legacy route. The quote composer lives at /composer;
 * anyone landing on the old URL is sent there.
 */

import { redirect } from "next/navigation";

export default function NewQuoteRedirect() {
  redirect("/composer");
}
