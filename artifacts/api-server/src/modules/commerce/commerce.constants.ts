export const ORDER_STATES = [
  "Draft",
  "AwaitingConfirmation",
  "Confirmed",
  "Reserved",
  "Preparing",
  "Ready",
  "Shipped",
  "Delivered",
  "Cancelled",
  "Returned",
  "Exchanged",
] as const;

export type CommerceOrderState = typeof ORDER_STATES[number];

export const ORDER_TRANSITIONS: Record<CommerceOrderState, CommerceOrderState[]> = {
  Draft: ["AwaitingConfirmation", "Cancelled"],
  AwaitingConfirmation: ["Confirmed", "Cancelled"],
  Confirmed: ["Reserved", "Cancelled"],
  Reserved: ["Preparing", "Cancelled"],
  Preparing: ["Ready", "Cancelled"],
  Ready: ["Shipped", "Delivered", "Cancelled"],
  Shipped: ["Delivered", "Returned"],
  Delivered: ["Returned", "Exchanged"],
  Cancelled: [],
  Returned: ["Exchanged"],
  Exchanged: [],
};

export const MOVEMENT_TYPES = [
  "Initial",
  "Adjustment",
  "Incoming",
  "Reservation",
  "Allocation",
  "Release",
  "Sale",
  "Cancellation",
  "Return",
  "Damage",
  "Transfer",
] as const;

export type InventoryMovementType = typeof MOVEMENT_TYPES[number];

export class CommerceConflictError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "CommerceConflictError";
  }
}
