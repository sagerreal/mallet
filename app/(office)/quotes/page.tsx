import { redirect } from "next/navigation";

/**
 * Quotes merged into the Pipeline rail — one journey, one page.
 * Old links land there.
 */
export default function QuotesRedirect() {
  redirect("/pipeline");
}
