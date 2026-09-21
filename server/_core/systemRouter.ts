import { z } from "zod";
import { publicProcedure, router } from "./trpc.js";
import { usersRouter } from "../usersRouter.js";

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
