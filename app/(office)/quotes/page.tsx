import { redirect } from "next/navigation";

/**
 * Quotes live on the work board on the Office page — one journey, one page.
 * Old links land there.
 */
export default function QuotesRedirect() {
  redirect("/dashboard");
}
