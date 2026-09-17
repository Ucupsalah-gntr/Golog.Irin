export function signedMovement(type: "in" | "out" | "adjustment", quantity: number) {
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Quantity must be a non-negative number");
  return type === "in" ? quantity : -quantity;
}

export function isLowStock(current: number, minimum: number) {
  return current <= minimum;
}

export function availableStock(current: number, allocated: number) {
  return Math.max(0, current - allocated);
}
