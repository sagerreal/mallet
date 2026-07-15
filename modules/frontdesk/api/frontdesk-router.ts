import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { DrizzleCrewScheduleRepository } from "../infra/drizzle-crew-schedule-repository";
import { SetCrewScheduleUseCase } from "../app/set-crew-schedule";

const crewScheduleDTO = z.object({
  userId: z.string(),
  weekday: z.number().int(),
  openHour: z.number().int(),
  closeHour: z.number().int(),
});

const crewScheduleListDTO = z.object({ items: z.array(crewScheduleDTO) });

const toCrewScheduleDTO = (r: {
  userId: string;
  weekday: number;
  openHour: number;
  closeHour: number;
}) => ({
  userId: r.userId,
  weekday: r.weekday,
  openHour: r.openHour,
  closeHour: r.closeHour,
});

const saveInput = z.object({
  userId: z.string().uuid(),
  entries: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        openHour: z.number().int().min(0).max(24),
        closeHour: z.number().int().min(0).max(24),
      }),
    )
    .max(7),
});

export const createFrontdeskRouter = () =>
  router({
    crewSchedules: router({
      list: ownerOrOffice
        .output(crewScheduleListDTO)
        .query(async ({ ctx }) => {
          const repo = new DrizzleCrewScheduleRepository(ctx.tx!, ctx.principal!.orgId);
          const items = await repo.listForOrg();
          return { items: items.map(toCrewScheduleDTO) };
        }),

      save: ownerOrOffice
        .input(saveInput)
        .output(crewScheduleListDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleCrewScheduleRepository(ctx.tx!, ctx.principal!.orgId);
          const useCase = new SetCrewScheduleUseCase(repo);
          const result = await useCase.exec(
            { userId: input.userId, entries: input.entries },
            ctx.principal!.orgId,
          );
          const saved = orThrow(result);
          return { items: saved.map(toCrewScheduleDTO) };
        }),
    }),
  });
