export type RequestStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "partial"
  | "rejected"
  | "ready"
  | "delivered"
  | "received"
  | "cancelled";

const allowedTransitions: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "partial", "rejected"],
  approved: [],
  partial: [],
  rejected: [],
  ready: [],
  delivered: [],
  received: [],
  cancelled: [],
};

export function canTransitionRequestStatus(from: RequestStatus, to: RequestStatus) {
  return allowedTransitions[from].includes(to);
}

export function validateApprovedQuantity(requestedQty: number, approvedQty: number) {
  if (!Number.isInteger(requestedQty) || requestedQty < 0) {
    throw new Error("Requested quantity is invalid");
  }
  if (!Number.isInteger(approvedQty) || approvedQty < 0) {
    throw new Error("Approved quantity is invalid");
  }
  if (approvedQty > requestedQty) {
    throw new Error("Approved quantity cannot exceed requested quantity");
  }
}
