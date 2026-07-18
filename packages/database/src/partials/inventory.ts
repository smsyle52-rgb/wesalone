import z from "zod"

// reserve: hold stock for a pending order (checkout)
// release: return held stock (order cancelled/expired before payment)
// consume: convert a hold into a permanent deduction (payment confirmed)
// receive: stock brought into a location (manual restock)
// adjustment: manual correction
export const inventoryMovementReasonTypes = z.enum([
  "reserve",
  "release",
  "consume",
  "receive",
  "adjustment",
])
export type InventoryMovementReasonType = z.infer<
  typeof inventoryMovementReasonTypes
>
