export type AutoSyncResult = {
  status: "success" | "partial" | "failed";
  itemsSynced: number;
  itemsFailed: number;
  error?: string;
};

export type MetaWhatsappChannelOption = {
  waba_id: string;
  business_id?: string;
};

export type MetaCatalogOption = {
  catalog_id: string;
  name: string;
  business_id?: string;
};

export type ResolvedMetaCatalogOption = MetaCatalogOption & {
  linked_waba_id: string | null;
};

type SyncableCatalogSource = {
  id: string;
  sourceType: string;
};

export function resolveCatalogsForSelectedWabas(params: {
  whatsappAccounts: MetaWhatsappChannelOption[];
  commerceCatalogs: MetaCatalogOption[];
  selectedWabaIds: string[];
  selectedCatalogIds: string[];
}): ResolvedMetaCatalogOption[] {
  const selectedCatalogIdSet = new Set(params.selectedCatalogIds);
  const selectedWabaIdSet = new Set(params.selectedWabaIds);
  const selectedWhatsappAccounts = params.whatsappAccounts.filter((account) => selectedWabaIdSet.has(account.waba_id));
  const fallbackWabaId = params.selectedWabaIds.length === 1 ? params.selectedWabaIds[0]! : null;
  const businessToWabaId = new Map<string, string>();

  for (const account of selectedWhatsappAccounts) {
    if (!account.business_id || businessToWabaId.has(account.business_id)) continue;
    businessToWabaId.set(account.business_id, account.waba_id);
  }

  const resolved: ResolvedMetaCatalogOption[] = [];

  if (selectedCatalogIdSet.size > 0) {
    for (const catalog of params.commerceCatalogs) {
      if (!selectedCatalogIdSet.has(catalog.catalog_id)) continue;
      resolved.push({
        ...catalog,
        linked_waba_id: catalog.business_id ? businessToWabaId.get(catalog.business_id) ?? fallbackWabaId : fallbackWabaId,
      });
    }
    return dedupeResolvedCatalogs(resolved);
  }

  if (businessToWabaId.size > 0) {
    for (const catalog of params.commerceCatalogs) {
      if (!catalog.business_id) continue;
      const linkedWabaId = businessToWabaId.get(catalog.business_id);
      if (!linkedWabaId) continue;
      resolved.push({ ...catalog, linked_waba_id: linkedWabaId });
    }
  }

  if (resolved.length === 0 && fallbackWabaId && params.commerceCatalogs.length === 1) {
    const [catalog] = params.commerceCatalogs;
    if (catalog) resolved.push({ ...catalog, linked_waba_id: fallbackWabaId });
  }

  return dedupeResolvedCatalogs(resolved);
}

function dedupeResolvedCatalogs(catalogs: ResolvedMetaCatalogOption[]): ResolvedMetaCatalogOption[] {
  const seen = new Set<string>();
  return catalogs.filter((catalog) => {
    if (seen.has(catalog.catalog_id)) return false;
    seen.add(catalog.catalog_id);
    return true;
  });
}

export async function autoSyncCreatedCatalogSources<TSource extends SyncableCatalogSource>(
  sources: TSource[],
  syncSource: (source: TSource) => Promise<AutoSyncResult>,
  onError?: (source: TSource, error: Error) => void,
): Promise<Map<string, AutoSyncResult>> {
  const results = new Map<string, AutoSyncResult>();

  // الطور 2 (11 يوليو 2026): منشورات الصفحة (page_posts) يتوقعها التاجر ظاهرة فوراً بعد الربط —
  // فتُزامَن فور الإنشاء أسوة بـcommerce_catalog. الإعلانات (ads) تبقى خارج المزامنة الفورية
  // عمداً: تتغيّر ببطء ويكفيها جدول Phase-1 الدوري (catalog-sync-scheduler) خلال ساعات قليلة.
  for (const source of sources) {
    if (source.sourceType !== "commerce_catalog" && source.sourceType !== "page_posts") continue;
    try {
      results.set(source.id, await syncSource(source));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(source, error);
      results.set(source.id, {
        status: "failed",
        itemsSynced: 0,
        itemsFailed: 1,
        error: error.message,
      });
    }
  }

  return results;
}
