import { describe, expect, it } from "vitest";
import { canAccessRoom, requireAssignedRoom } from "../shared/room-access";

describe("room access rules", () => {
  it("allows admin to access any room", () => {
    expect(canAccessRoom("admin", null, 1)).toBe(true);
    expect(canAccessRoom("admin", 2, 99)).toBe(true);
  });

  it("allows a petugas only in their assigned room", () => {
    expect(canAccessRoom("user", 7, 7)).toBe(true);
    expect(canAccessRoom("user", 7, 8)).toBe(false);
  });

  it("denies a petugas with no room assignment", () => {
    expect(canAccessRoom("user", null, 7)).toBe(false);
    expect(() => requireAssignedRoom("user", null)).toThrow("belum memiliki ruangan");
  });

  it("returns no forced room for admin and the assigned room for petugas", () => {
    expect(requireAssignedRoom("admin", null)).toBeNull();
    expect(requireAssignedRoom("admin", 4)).toBeNull();
    expect(requireAssignedRoom("user", 4)).toBe(4);
  });
});
