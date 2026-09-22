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

export function validateApprovalStatus(
  status: "approved" | "partial",
  lines: Array<{ requestedQty: number; approvedQty: number }>,
) {
  if (!lines.length) {
    throw new Error("Approval lines are required");
  }

  for (const line of lines) {
    validateApprovedQuantity(line.requestedQty, line.approvedQty);
  }

  const totalApproved = lines.reduce((sum, line) => sum + line.approvedQty, 0);
  if (totalApproved <= 0) {
    throw new Error("Approved quantity must be greater than zero");
  }

  if (status === "approved" && lines.some((line) => line.approvedQty !== line.requestedQty)) {
    throw new Error("Approved status requires the full requested quantity for every item");
  }

  if (status === "partial" && lines.every((line) => line.approvedQty === line.requestedQty)) {
    throw new Error("Partial status requires at least one item to be approved below the requested quantity");
  }
}
