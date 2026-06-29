import type { StockMovement } from "./types";

const labels: Record<string, string> = {
  Initial: "افتتاحي", Adjustment: "تعديل", Incoming: "وارد", Reservation: "حجز",
  Allocation: "تخصيص", Release: "تحرير", Sale: "بيع", Cancellation: "إلغاء",
  Return: "إرجاع", Damage: "تالف", Transfer: "تحويل",
};

export function CommerceMovementsTab({ movements }: { movements: StockMovement[] }) {
  return <div className="space-y-2">{movements.map((movement) => (
    <div key={movement.id} className="rounded-xl border bg-white p-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-gray-100 px-2 py-1 text-xs">{labels[movement.movementType] ?? movement.movementType}</span>
        <b className={movement.quantity < 0 ? "text-red-600" : "text-green-700"}>{movement.quantity > 0 ? "+" : ""}{movement.quantity}</b>
        <span>{movement.productName} — {movement.variantTitle}</span>
        <span className="text-gray-400">{movement.locationName}</span>
      </div>
      <p className="mt-2 text-gray-600">{movement.reason}</p>
      <p className="mt-1 text-xs text-gray-400">{new Date(movement.createdAt).toLocaleString("ar")}</p>
    </div>
  ))}</div>;
}
