import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../../server/routers.ts";
import { createContext } from "../../server/_core/context.ts";

const app = express();

app.set("trust proxy", 1);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

export default app;
