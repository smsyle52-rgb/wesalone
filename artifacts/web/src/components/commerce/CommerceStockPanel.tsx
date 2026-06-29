import { useQuery } from "@tanstack/react-query";
import { commerceApi } from "./api";
import { CommerceStockTab } from "./CommerceStockTab";

export function CommerceStockPanel() {
  const query = useQuery({ queryKey: ["commerce-levels"], queryFn: () => commerceApi("inventory/levels") });
  return <CommerceStockTab levels={query.data?.levels ?? []} />;
}
