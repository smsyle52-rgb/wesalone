import type { StockLevel } from "./types";

export function CommerceStockTab({ levels }: { levels: StockLevel[] }) {
  return <div className="space-y-3">{levels.map((level) => (
    <div key={level.id} className="rounded-2xl border bg-white p-4">
      <strong>{level.productName} — {level.variantTitle}</strong>
      <p className="text-xs text-gray-500">{level.locationName}</p>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
        <span className="rounded-lg bg-gray-50 p-2">فعلي<br/><b>{level.onHand}</b></span>
        <span className="rounded-lg bg-amber-50 p-2">محجوز<br/><b>{level.reserved}</b></span>
        <span className="rounded-lg bg-blue-50 p-2">وارد<br/><b>{level.incoming}</b></span>
        <span className="rounded-lg bg-green-50 p-2">متاح<br/><b>{level.available}</b></span>
      </div>
    </div>
  ))}</div>;
}
