import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { CommerceProductsPanel } from "@/components/commerce/CommerceProductsPanel";
import { CommerceStockPanel } from "@/components/commerce/CommerceStockPanel";
import { CommerceMovementsPanel } from "@/components/commerce/CommerceMovementsPanel";
import { CommerceLocationsPanel } from "@/components/commerce/CommerceLocationsPanel";
import type { CommerceTab } from "@/components/commerce/types";

const tabs: Array<[CommerceTab, string]> = [
  ["products", "المنتجات"],
  ["stock", "المخزون حسب الموقع"],
  ["movements", "سجل الحركات"],
  ["locations", "المواقع"],
];

export default function CommerceInventoryPage() {
  const [tab, setTab] = useState<CommerceTab>("products");
  return <div className="space-y-5 p-4 sm:p-6" dir="rtl">
    <PageHeader title="التجارة والمخزون" subtitle="منتجات ومتغيرات ومواقع وحجوزات وحركات مخزون" />
    <div className="flex gap-1 overflow-x-auto rounded-xl border bg-white p-1">
      {tabs.map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm ${tab === value ? "bg-blue-600 text-white" : "text-gray-600"}`}>{label}</button>)}
    </div>
    {tab === "products" && <CommerceProductsPanel />}
    {tab === "stock" && <CommerceStockPanel />}
    {tab === "movements" && <CommerceMovementsPanel />}
    {tab === "locations" && <CommerceLocationsPanel />}
  </div>;
}
