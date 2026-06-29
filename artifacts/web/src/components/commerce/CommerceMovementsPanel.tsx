import { useQuery } from "@tanstack/react-query";
import { commerceApi } from "./api";
import { CommerceMovementsTab } from "./CommerceMovementsTab";

export function CommerceMovementsPanel() {
  const query = useQuery({ queryKey: ["commerce-movements"], queryFn: () => commerceApi("inventory/movements?limit=100") });
  return <CommerceMovementsTab movements={query.data?.movements ?? []} />;
}
