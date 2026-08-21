import type { Role } from "@mallet/identity";

/**
 * modules/ai/domain/tool-filter.ts
 * Least privilege for the agent: the catalog a principal may drive, by role.
 *
 * Every role check in the AI surface today lives at the transport boundary (`ai-router` is
 * ownerOrOffice; the MCP executor checks owner|office). A background runner has no transport, so
 * the gate has to live with the tools instead — and the runner's principal is the task creator,
 * whose role was snapshotted when the task was filed.
 *
 * Generic over the shape so both `AgentTool[]` and `ToolMeta[]` can be filtered with one function.
 */
export const toolsForRole = <T extends { readonly mutating: boolean }>(
  tools: readonly T[],
  role: Role,
): readonly T[] => (role === "tech" ? tools.filter((t) => !t.mutating) : [...tools]);
