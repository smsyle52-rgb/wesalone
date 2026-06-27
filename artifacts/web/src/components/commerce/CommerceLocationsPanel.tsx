import { useQuery } from "@tanstack/react-query";
import { commerceApi } from "./api";
import { CommerceLocationsTab } from "./CommerceLocationsTab";

export function CommerceLocationsPanel() {
  const query = useQuery({ queryKey: ["commerce-locations"], queryFn: () => commerceApi("inventory/locations") });
  return <CommerceLocationsTab locations={query.data?.locations ?? []} />;
}
