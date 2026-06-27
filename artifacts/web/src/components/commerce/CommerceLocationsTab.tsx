import type { StockLocation } from "./types";

const labels: Record<string, string> = {
  warehouse: "مخزن رئيسي",
  branch: "فرع",
  showroom: "معرض",
  point_of_sale: "نقطة بيع",
  virtual: "موقع افتراضي",
};

export function CommerceLocationsTab({ locations }: { locations: StockLocation[] }) {
  return <div className="space-y-3">{locations.map((location) => (
    <div key={location.id} className="flex justify-between rounded-xl border bg-white p-4">
      <div>
        <strong>{location.name}</strong>
        <p className="text-xs text-gray-500">{labels[location.type] ?? location.type}</p>
      </div>
      {location.isDefault && <span className="h-fit rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">افتراضي</span>}
    </div>
  ))}</div>;
}
