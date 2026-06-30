import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/trpc/root";
import { createContext } from "@/trpc/context";
import { getAppDeps } from "@/trpc/di";

// Single Next.js route that serves the whole tRPC tree under /api/trpc. Each request gets a
// fresh context (auth + deps); the org-scoped transaction opens inside the procedure middleware.
const handler = (req: Request): Promise<Response> =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext({ req, deps: getAppDeps() }),
  });

export { handler as GET, handler as POST };
