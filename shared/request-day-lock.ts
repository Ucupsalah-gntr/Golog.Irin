export function getJakartaDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function canReuseRequestDayLock(requesterId: number, currentUserId: number): boolean {
  return requesterId === currentUserId;
}
