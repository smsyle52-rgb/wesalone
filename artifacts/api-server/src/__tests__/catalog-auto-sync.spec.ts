import { describe, expect, it, vi } from "vitest";
import { autoSyncCreatedCatalogSources, resolveCatalogsForSelectedWabas } from "../modules/integrations/catalog-auto-sync";

describe("catalog auto sync", () => {
  it("auto-selects catalogs that belong to the selected WABA business", () => {
    const catalogs = resolveCatalogsForSelectedWabas({
      whatsappAccounts: [
        { waba_id: "waba-1", business_id: "biz-1" },
        { waba_id: "waba-2", business_id: "biz-2" },
      ],
      commerceCatalogs: [
        { catalog_id: "cat-1", name: "Catalog 1", business_id: "biz-1" },
        { catalog_id: "cat-2", name: "Catalog 2", business_id: "biz-2" },
      ],
      selectedWabaIds: ["waba-1"],
      selectedCatalogIds: [],
    });

    expect(catalogs).toEqual([
      { catalog_id: "cat-1", name: "Catalog 1", business_id: "biz-1", linked_waba_id: "waba-1" },
    ]);
  });

  it("preserves explicit catalog selections and links them to the matching WABA when possible", () => {
    const catalogs = resolveCatalogsForSelectedWabas({
      whatsappAccounts: [
        { waba_id: "waba-1", business_id: "biz-1" },
      ],
      commerceCatalogs: [
        { catalog_id: "cat-1", name: "Catalog 1", business_id: "biz-1" },
        { catalog_id: "cat-2", name: "Catalog 2", business_id: "biz-9" },
      ],
      selectedWabaIds: ["waba-1"],
      selectedCatalogIds: ["cat-1", "cat-2"],
    });

    expect(catalogs).toEqual([
      { catalog_id: "cat-1", name: "Catalog 1", business_id: "biz-1", linked_waba_id: "waba-1" },
      { catalog_id: "cat-2", name: "Catalog 2", business_id: "biz-9", linked_waba_id: "waba-1" },
    ]);
  });

  it("auto-syncs new commerce catalog sources", async () => {
    const syncSource = vi.fn(async (source: { id: string; sourceType: string }) => ({
      status: "success" as const,
      itemsSynced: source.id === "catalog-1" ? 3 : 0,
      itemsFailed: 0,
    }));

    const results = await autoSyncCreatedCatalogSources([
      { id: "catalog-1", sourceType: "commerce_catalog" },
      { id: "ads-1", sourceType: "ads" },
    ], syncSource);

    expect(syncSource).toHaveBeenCalledTimes(1);
    expect(syncSource).toHaveBeenCalledWith({ id: "catalog-1", sourceType: "commerce_catalog" });
    expect(results.get("catalog-1")).toEqual({
      status: "success",
      itemsSynced: 3,
      itemsFailed: 0,
    });
    expect(results.has("ads-1")).toBe(false);
  });

  // الطور 2 (11 يوليو 2026): التاجر يتوقع ظهور منشورات صفحته فوراً بعد الربط — page_posts
  // ينضم الآن لـcommerce_catalog في المزامنة الفورية، بينما ads يبقى خارجها عمداً (يكفيه
  // جدول Phase-1 الدوري خلال ساعات).
  it("auto-syncs new page_posts sources alongside commerce catalog sources, but still skips ads", async () => {
    const syncSource = vi.fn(async (source: { id: string; sourceType: string }) => ({
      status: "success" as const,
      itemsSynced: source.id === "catalog-1" ? 3 : source.id === "posts-1" ? 2 : 0,
      itemsFailed: 0,
    }));

    const results = await autoSyncCreatedCatalogSources([
      { id: "catalog-1", sourceType: "commerce_catalog" },
      { id: "posts-1", sourceType: "page_posts" },
      { id: "ads-1", sourceType: "ads" },
    ], syncSource);

    expect(syncSource).toHaveBeenCalledTimes(2);
    expect(syncSource).toHaveBeenCalledWith({ id: "catalog-1", sourceType: "commerce_catalog" });
    expect(syncSource).toHaveBeenCalledWith({ id: "posts-1", sourceType: "page_posts" });
    expect(results.get("catalog-1")).toEqual({ status: "success", itemsSynced: 3, itemsFailed: 0 });
    expect(results.get("posts-1")).toEqual({ status: "success", itemsSynced: 2, itemsFailed: 0 });
    expect(results.has("ads-1")).toBe(false);
  });

  it("captures sync failures without throwing", async () => {
    const onError = vi.fn();
    const syncSource = vi.fn(async () => {
      throw new Error("Meta Graph API returned 403");
    });

    const results = await autoSyncCreatedCatalogSources([
      { id: "catalog-2", sourceType: "commerce_catalog" },
    ], syncSource, onError);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(results.get("catalog-2")).toEqual({
      status: "failed",
      itemsSynced: 0,
      itemsFailed: 1,
      error: "Meta Graph API returned 403",
    });
  });
});
