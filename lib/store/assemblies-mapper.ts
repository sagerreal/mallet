/**
 * lib/store/assemblies-mapper.ts
 * DTO<->store boundary for estimating assemblies (v1.assemblies).
 *
 * DELIBERATE DEVIATION from the dollars-in-store rule, confined to this one
 * domain: an assembly's numbers stay in WIRE UNITS (integer cents, bps, raw
 * conversion factors) inside the store. They are not display money — they are
 * the constants the shared pure engine (modules/assemblies/domain/
 * compute-assembly.ts) consumes, and the composer runs that engine CLIENT-SIDE
 * for held traces; converting the nested config blob to dollars and back would
 * reintroduce the exact drift the shared engine exists to prevent. Display
 * conversion happens per-dial in the editor via dialDisplayValue/dialRawValue
 * (the dial's `format` says how), never here.
 */

import type { RouterOutputs } from "@/lib/trpc/client";

export type AssemblyItemDTO = RouterOutputs["v1"]["assemblies"]["list"][number];
export type AssemblyDialViewDTO = AssemblyItemDTO["dials"][number];
export type AssemblySeedResultDTO = RouterOutputs["v1"]["assemblies"]["seedFromCapture"];

/** The store keeps the wire shape verbatim (see the header note). */
export type AssemblyView = AssemblyItemDTO;

export function assemblyDtoToStore(dto: AssemblyItemDTO): AssemblyView {
  return {
    ...dto,
    config: dto.config,
    dials: dto.dials.map((dial) => ({ ...dial })),
  };
}
