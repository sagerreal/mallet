import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/trpc/root";

export const api = createTRPCReact<AppRouter>();
