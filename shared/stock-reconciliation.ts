export function calculateStockDifference(systemQty: number, physicalQty: number): number {
  if (!Number.isInteger(systemQty) || systemQty < 0) {
    throw new Error("System quantity is invalid");
  }
  if (!Number.isInteger(physicalQty) || physicalQty < 0) {
    throw new Error("Physical quantity is invalid");
  }
  return physicalQty - systemQty;
}

export function calculateAdjustedStock(systemQty: number, physicalQty: number): number {
  return systemQty + calculateStockDifference(systemQty, physicalQty);
}
