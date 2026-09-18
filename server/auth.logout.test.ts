import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createContext(): TrpcContext {
  return {
    user: null,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("auth.logout", () => {
  it("reports a successful logout request", async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
  });
});
