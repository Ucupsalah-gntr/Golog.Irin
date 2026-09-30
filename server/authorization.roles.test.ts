import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createContext(role: "admin" | "user"): TrpcContext {
  return {
    user: {
      id: 99,
      username: role === "admin" ? "testadmin" : "testpetugas",
      name: role === "admin" ? "Test Admin" : "Test Petugas",
      email: role === "admin" ? "testadmin@example.com" : "testpetugas@example.com",
      authUserId: null,
      role,
      roomId: role === "admin" ? null : 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("server-side role authorization", () => {
  it("rejects unauthenticated access to admin-only reports", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    });

    await expect(caller.reports.monthly({ month: "2026-09" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects petugas access to admin-only reports", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await expect(caller.reports.monthly({ month: "2026-09" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects petugas access to admin-only stock actions", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await expect(
      caller.catalog.createItem({
        sku: "TEST-ROLE-001",
        name: "Role test item",
        unit: "box",
        category: "test",
        sourceWarehouseId: null,
        minStock: 0,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(caller.adjustments.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects petugas access to request approval", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await expect(
      caller.requests.verify({
        requestId: 1,
        status: "rejected",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
