export type AppRole = "admin" | "user";

/**
 * Room access rule used by request APIs.
 * Admins are not limited by a room assignment.
 * Regular users may only access their assigned room.
 */
export function canAccessRoom(
  role: AppRole,
  assignedRoomId: number | null | undefined,
  targetRoomId: number,
) {
  if (role === "admin") return true;
  if (assignedRoomId == null) return false;
  return assignedRoomId === targetRoomId;
}

export function requireAssignedRoom(
  role: AppRole,
  assignedRoomId: number | null | undefined,
): number | null {
  if (role === "admin") return null;
  if (assignedRoomId == null) {
    throw new Error("Akun petugas belum memiliki ruangan.");
  }
  return assignedRoomId;
}
