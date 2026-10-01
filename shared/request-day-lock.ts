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


export function addJakartaDays(dateKey: string, days: number): string {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(dateKey) || !Number.isInteger(days)) {
    throw new Error("Invalid Jakarta date");
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isRequestDateWithinWindow(requestDate: string, today = getJakartaDateKey(), maxDaysAhead = 7): boolean {
  return requestDate >= today && requestDate <= addJakartaDays(today, maxDaysAhead);
}
