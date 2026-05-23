import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

const BASE = `${import.meta.env.BASE_URL}api`;
const apiFetch = async (path: string, opts?: RequestInit) => {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    try { const j = JSON.parse(text); throw new Error(j.error ?? text); } catch { throw new Error(text); }
  }
  return res.json();
};

function PermissionDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <span className="text-4xl">🔒</span>
      <p className="text-muted-foreground text-sm">ليس لديك صلاحية لعرض العملاء</p>
    </div>
  );
}

const BLANK_FORM = { name: "", phone: "", email: "", city: "", company: "", tags: [] as string[] };

export default function ContactsPage() {
  const { hasPermission } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const canRead = hasPermission("contacts:read");
  const canCreate = hasPermission("contacts:create");

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["contacts", search, page],
    queryFn: () => apiFetch(`contacts?search=${encodeURIComponent(search)}&page=${page}&limit=20`),
    enabled: canRead,
  });

  const createContact = useMutation({
    mutationFn: (body: typeof BLANK_FORM) =>
      apiFetch("contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setShowNew(false);
      setForm(BLANK_FORM);
    },
  });

  const contacts: any[] = data?.contacts ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  const columns = [
    {
      key: "name",
      label: "العميل",
      render: (r: any) => (
        <button
          onClick={() => navigate(`/contacts/${r.id}`)}
          className="flex items-center gap-3 text-start hover:opacity-80 transition-opacity"
        >
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
            {r.name?.[0] ?? "؟"}
          </div>
          <div>
            <div className="font-medium text-foreground text-sm">{r.name}</div>
            {r.company && <div className="text-xs text-muted-foreground">{r.company}</div>}
          </div>
        </button>
      ),
    },
    {
      key: "phone",
      label: "الهاتف",
      render: (r: any) => (
        <span className="text-sm text-foreground font-mono" dir="ltr">{r.phone ?? "—"}</span>
      ),
    },
    {
      key: "email",
      label: "البريد",
      render: (r: any) => (
        <span className="text-sm text-muted-foreground" dir="ltr">{r.email ?? "—"}</span>
      ),
    },
    {
      key: "city",
      label: "المدينة",
      render: (r: any) => <span className="text-sm text-muted-foreground">{r.city ?? "—"}</span>,
    },
    {
      key: "createdAt",
      label: "تاريخ الإضافة",
      render: (r: any) => <span className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>,
    },
    {
      key: "actions",
      label: "",
      render: (r: any) => (
        <button
          onClick={() => navigate(`/contacts/${r.id}`)}
          className="text-xs text-primary hover:underline px-2 py-1"
        >
          عرض الملف
        </button>
      ),
    },
  ];

  if (!canRead) return (
    <>
      <PageHeader title="جهات الاتصال" subtitle="قاعدة بيانات العملاء والشركاء" />
      <PermissionDenied />
    </>
  );

  return (
    <div dir="rtl">
      <PageHeader
        title="جهات الاتصال"
        subtitle={`${total} عميل في قاعدة البيانات`}
        actions={
          canCreate ? (
            <button
              onClick={() => setShowNew(true)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              + إضافة جهة اتصال
            </button>
          ) : (
            <button
              disabled
              title="ليس لديك صلاحية إضافة عملاء"
              className="px-4 py-2 rounded-lg bg-primary/40 text-primary-foreground text-sm font-semibold cursor-not-allowed opacity-50"
            >
              + إضافة جهة اتصال
            </button>
          )
        }
      />

      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="ابحث بالاسم أو الهاتف أو الشركة أو البريد..."
          className="w-full max-w-sm px-3 py-2 rounded-lg border border-input bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {isError && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm flex items-center justify-between">
          <span>تعذّر تحميل جهات الاتصال.</span>
          <button onClick={() => refetch()} className="text-xs underline font-medium">إعادة المحاولة</button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={contacts}
        keyExtractor={(r: any) => r.id}
        isLoading={isLoading}
        emptyMessage="لا توجد جهات اتصال بعد. أضف أول عميل أو انتظر وصول أول محادثة من القنوات المرتبطة."
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
          <span className="text-xs">{((page - 1) * 20) + 1}–{Math.min(page * 20, total)} من {total}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors"
            >السابق</button>
            <span className="px-2 py-1.5 text-xs">{page}/{totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors"
            >التالي</button>
          </div>
        </div>
      )}

      <Modal open={showNew} onClose={() => { setShowNew(false); setForm(BLANK_FORM); }} title="جهة اتصال جديدة">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">الاسم *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="اسم العميل"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">الهاتف</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="7XX XXX XXX"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">البريد الإلكتروني</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="email@example.com"
                dir="ltr"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">الشركة</label>
              <input
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="اسم الشركة"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">المدينة</label>
              <input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="صنعاء، عدن..."
              />
            </div>
          </div>
          {createContact.isError && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
              {(createContact.error as Error)?.message ?? "حدث خطأ"}
            </div>
          )}
          <button
            onClick={() => createContact.mutate(form)}
            disabled={createContact.isPending || !form.name.trim()}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {createContact.isPending ? "جار الإضافة..." : "إضافة جهة الاتصال"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
