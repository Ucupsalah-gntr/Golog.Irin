import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { usersRouter } from "../usersRouter";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  users: usersRouter,
});
