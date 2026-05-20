import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/ui/PageHeader";

const BASE = `${import.meta.env.BASE_URL}api`;

type MetaOptions = {
  whatsapp_accounts: Array<{
    waba_id: string;
    name: string;
    phone_numbers: Array<{
      phone_number_id: string;
      display_number: string;
      verified_name?: string;
    }>;
  }>;
  facebook_pages: Array<{ page_id: string; name: string }>;
  instagram_accounts: Array<{ ig_account_id: string; username: string; linked_page_id: string }>;
  commerce_catalogs: Array<{ catalog_id: string; name: string; business_id?: string }>;
  ad_accounts: Array<{ ad_account_id: string; name: string; business_id?: string }>;
};

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function MetaConnectChannelsPage() {
  const [, setLocation] = useLocation();
  const [options, setOptions] = useState<MetaOptions | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whatsappPhoneIds, setWhatsappPhoneIds] = useState<string[]>([]);
  const [instagramAccountIds, setInstagramAccountIds] = useState<string[]>([]);
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [catalogIds, setCatalogIds] = useState<string[]>([]);
  const [adAccountIds, setAdAccountIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`${BASE}/integrations/meta/channels/options`, { credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "تعذر تحميل القنوات المتاحة");
        if (!cancelled) setOptions(data.options);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasAnyOption = useMemo(() => {
    if (!options) return false;
    return options.whatsapp_accounts.some((account) => account.phone_numbers.length > 0) ||
      options.instagram_accounts.length > 0 ||
      options.facebook_pages.length > 0 ||
      options.commerce_catalogs.length > 0 ||
      options.ad_accounts.length > 0;
  }, [options]);

  async function saveSelection() {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/integrations/meta/channels`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          whatsapp_phone_ids: whatsappPhoneIds,
          instagram_account_ids: instagramAccountIds,
          page_ids: pageIds,
          catalog_ids: catalogIds,
          ad_account_ids: adAccountIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "تعذر حفظ القنوات المختارة");
      setLocation("/integrations");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div dir="rtl" className="space-y-6">
      <PageHeader
        title="اختيار قنوات ميتا"
        subtitle="اختر القنوات التي تريد تشغيلها داخل خدماتك. لن يظهر أي مفتاح أو رمز وصول في هذه الصفحة."
      />

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          جار تحميل القنوات المتاحة...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6">
          <p className="text-sm text-destructive">{error}</p>
          <button
            type="button"
            onClick={() => setLocation("/integrations")}
            className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-semibold"
          >
            العودة للتكاملات
          </button>
        </div>
      ) : !options || !hasAnyOption ? (
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-base font-semibold text-foreground">لا توجد قنوات جاهزة للاختيار</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            أكمل إعداد تطبيق ميتا والصلاحيات المطلوبة، ثم أعد تشغيل الربط من صفحة التكاملات.
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground">واتساب</h2>
            <div className="mt-4 space-y-3">
              {options.whatsapp_accounts.flatMap((account) =>
                account.phone_numbers.map((phone) => (
                  <label key={phone.phone_number_id} className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                    <span>
                      <span className="block text-sm font-semibold text-foreground">
                        {phone.display_number || phone.phone_number_id}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {account.name} {phone.verified_name ? `- ${phone.verified_name}` : ""}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={whatsappPhoneIds.includes(phone.phone_number_id)}
                      onChange={() => setWhatsappPhoneIds((current) => toggle(current, phone.phone_number_id))}
                    />
                  </label>
                )),
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground">إنستقرام</h2>
            <div className="mt-4 space-y-3">
              {options.instagram_accounts.map((account) => (
                <label key={account.ig_account_id} className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{account.username}</span>
                    <span className="text-xs text-muted-foreground">مرتبط بصفحة: {account.linked_page_id}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={instagramAccountIds.includes(account.ig_account_id)}
                    onChange={() => setInstagramAccountIds((current) => toggle(current, account.ig_account_id))}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground">ماسنجر (صفحات فيسبوك)</h2>
            <div className="mt-4 space-y-3">
              {options.facebook_pages.map((page) => (
                <label key={page.page_id} className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{page.name}</span>
                    <span className="text-xs text-muted-foreground">{page.page_id}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={pageIds.includes(page.page_id)}
                    onChange={() => setPageIds((current) => toggle(current, page.page_id))}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground">كتالوجات ميتا</h2>
            <div className="mt-4 space-y-3">
              {options.commerce_catalogs.map((catalog) => (
                <label key={catalog.catalog_id} className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{catalog.name}</span>
                    <span className="text-xs text-muted-foreground">{catalog.catalog_id}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={catalogIds.includes(catalog.catalog_id)}
                    onChange={() => setCatalogIds((current) => toggle(current, catalog.catalog_id))}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground">حسابات الإعلانات</h2>
            <div className="mt-4 space-y-3">
              {options.ad_accounts.map((account) => (
                <label key={account.ad_account_id} className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{account.name}</span>
                    <span className="text-xs text-muted-foreground">{account.ad_account_id}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={adAccountIds.includes(account.ad_account_id)}
                    onChange={() => setAdAccountIds((current) => toggle(current, account.ad_account_id))}
                  />
                </label>
              ))}
            </div>
          </section>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setLocation("/integrations")}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={saveSelection}
              disabled={isSaving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {isSaving ? "جار الحفظ..." : "حفظ القنوات المختارة"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
