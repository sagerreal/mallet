import { redirect } from "next/navigation";

/**
 * There is no chat page. The AI surface is the command bar on every screen —
 * old links land on Home, where the bar (and the Handoff) are waiting.
 */
export default function AssistantRedirect() {
  redirect("/dashboard");
}
