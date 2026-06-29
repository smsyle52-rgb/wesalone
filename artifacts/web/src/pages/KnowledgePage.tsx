import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { extractTextFromFile, ACCEPTED_FILE_EXTENSIONS } from "@/lib/fileExtract";
import { Library, Search, Plus, FileText, FolderOpen, HelpCircle, Settings2, Lock, Database, Paperclip, Link2, type LucideIcon } from "lucide-react";

function apiFetch(path: string, opts?: RequestInit) {
  return fetch(`${import.meta.env.BASE_URL}api/knowledge/${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  }).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "خطأ في الخادم");
    return data;
  });
}

const STATUS_LABELS: Record<string, string> = {
  active: "نشط", archived: "مؤرشف",
  draft: "مسودة", processing: "قيد المعالجة", ready: "جاهز", failed: "فشل",
  pending: "بانتظار التضمين", skipped: "متجاوز", embedded: "مضمّن",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  archived: "bg-gray-100 text-gray-500",
  draft: "bg-yellow-100 text-yellow-800",
  processing: "bg-blue-100 text-blue-800",
  ready: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  pending: "bg-yellow-100 text-yellow-800",
  skipped: "bg-gray-100 text-gray-500",
  embedded: "bg-purple-100 text-purple-800",
};

function Badge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

type KnowledgeBase = { id: string; name: string; description?: string | null; status: string; createdAt: string };
type KnowledgeSource = { id: string; type: string; title: string; status: string; rawText?: string | null; createdAt: string };
type KnowledgeDocument = { id: string; title: string; contentText: string; status: string; tokenEstimate?: number | null; createdAt: string };
type FaqEntry = { id: string; question: string; answer: string; category?: string | null; status: string; createdAt: string };

type KnowledgeTab = "sources" | "documents" | "faqs" | "settings";

export default function KnowledgePage() {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();

  const canRead = hasPermission("knowledge:read");
  const canCreate = hasPermission("knowledge:create");
  const canUpdate = hasPermission("knowledge:update");
  const canDelete = hasPermission("knowledge:delete");

  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<KnowledgeTab>("sources");
  const [showCreateBase, setShowCreateBase] = useState(false);
  const [createBaseForm, setCreateBaseForm] = useState({ name: "", description: "" });
  const [showCreateSource, setShowCreateSource] = useState(false);
  const [createSourceForm, setCreateSourceForm] = useState({ type: "text", title: "", rawText: "" });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showCreateDoc, setShowCreateDoc] = useState(false);
  const [createDocForm, setCreateDocForm] = useState({ title: "", contentText: "" });
  const [showCreateFaq, setShowCreateFaq] = useState(false);
  const [createFaqForm, setCreateFaqForm] = useState({ question: "", answer: "", category: "" });
  const [editingFaq, setEditingFaq] = useState<FaqEntry | null>(null);
  const [editFaqForm, setEditFaqForm] = useState({ question: "", answer: "", category: "" });
  const [editingDoc, setEditingDoc] = useState<KnowledgeDocument | null>(null);
  const [editDocForm, setEditDocForm] = useState({ title: "", contentText: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const basesQuery = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: () => apiFetch("bases"),
    enabled: canRead,
  });

  const selectedBase = (basesQuery.data?.bases as KnowledgeBase[] ?? []).find((b) => b.id === selectedBaseId);

  const sourcesQuery = useQuery({
    queryKey: ["knowledge-sources", selectedBaseId],
    queryFn: () => apiFetch(`bases/${selectedBaseId}/sources`),
    enabled: !!selectedBaseId && canRead && activeTab === "sources",
  });

  const docsQuery = useQuery({
    queryKey: ["knowledge-docs", selectedBaseId],
    queryFn: () => apiFetch(`bases/${selectedBaseId}/documents`),
    enabled: !!selectedBaseId && canRead && activeTab === "documents",
  });

  const faqsQuery = useQuery({
    queryKey: ["knowledge-faqs", selectedBaseId],
    queryFn: () => apiFetch(`bases/${selectedBaseId}/faqs`),
    enabled: !!selectedBaseId && canRead && activeTab === "faqs",
  });

  const searchQuery_ = useQuery({
    queryKey: ["knowledge-search", searchQuery, selectedBaseId],
    queryFn: () => {
      const params = new URLSearchParams({ q: searchQuery });
      if (selectedBaseId) params.set("baseId", selectedBaseId);
      return apiFetch(`search?${params}`);
    },
    enabled: searchQuery.length >= 2 && canRead,
  });

  const createBase = useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      apiFetch("bases", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["knowledge-bases"] });
      setShowCreateBase(false);
      setCreateBaseForm({ name: "", description: "" });
      setSelectedBaseId(data.base.id);
    },
  });

  const archiveBase = useMutation({
    mutationFn: (id: string) => apiFetch(`bases/${id}/archive`, { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge-bases"] });
      setSelectedBaseId(null);
    },
  });

  const createSource = useMutation({
    mutationFn: (data: object) => apiFetch(`bases/${selectedBaseId}/sources`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge-sources", selectedBaseId] });
      setShowCreateSource(false);
      setCreateSourceForm({ type: "text", title: "", rawText: "" });
    },
  });

  // رفع ملف: نستخرج النص في المتصفح ثم نرسله لمسار الإدراج الذرّي (مصدر + وثيقة + chunks).
  const uploadFileSource = useMutation({
    mutationFn: async ({ file, title }: { file: File; title: string }) => {
      const { text } = await extractTextFromFile(file);
      return apiFetch(`bases/${selectedBaseId}/sources/from-file`, {
        method: "POST",
        body: JSON.stringify({ title, text, fileName: file.name, mimeType: file.type || undefined, byteSize: file.size }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge-sources", selectedBaseId] });
      qc.invalidateQueries({ queryKey: ["knowledge-docs", selectedBaseId] });
      setShowCreateSource(false);
      setCreateSourceForm({ type: "text", title: "", rawText: "" });
      setSelectedFile(null);
    },
  });

  const closeCreateSource = () => {
    setShowCreateSource(false);
    setSelectedFile(null);
  };

  const archiveSource = useMutation({
    mutationFn: (id: string) => apiFetch(`sources/${id}/archive`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge-sources", selectedBaseId] }),
  });

  const createDoc = useMutation({
    mutationFn: (data: object) => apiFetch(`bases/${selectedBaseId}/documents`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge-docs", selectedBaseId] });
      setShowCreateDoc(false);
      setCreateDocForm({ title: "", contentText: "" });
    },
  });

  const updateDoc = useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; contentText?: string; status?: string }) =>
      apiFetch(`documents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge-docs", selectedBaseId] });
      setEditingDoc(null);
    },
  });

  const archiveDoc = useMutation({
    mutationFn: (id: string) => apiFetch(`documents/${id}/archive`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge-docs", selectedBaseId] }),
  });

  const createFaq = useMutation({
    mutationFn: (data: object) => apiFetch(`bases/${selectedBaseId}/faqs`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge-faqs", selectedBaseId] });
      setShowCreateFaq(false);
      setCreateFaqForm({ question: "", answer: "", category: "" });
    },
  });

  const updateFaq = useMutation({
    mutationFn: ({ id, ...data }: { id: string; question?: string; answer?: string; category?: string | null }) =>
      apiFetch(`faqs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge-faqs", selectedBaseId] });
      setEditingFaq(null);
    },
  });

  const archiveFaq = useMutation({
    mutationFn: (id: string) => apiFetch(`faqs/${id}/archive`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge-faqs", selectedBaseId] }),
  });

  const deleteSource = useMutation({
    mutationFn: (id: string) => apiFetch(`sources/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge-sources", selectedBaseId] }),
  });
  const deleteDoc = useMutation({
    mutationFn: (id: string) => apiFetch(`documents/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge-docs", selectedBaseId] }),
  });
  const deleteFaq = useMutation({
    mutationFn: (id: string) => apiFetch(`faqs/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge-faqs", selectedBaseId] }),
  });

  if (!canRead) {
    return (
      <div dir="rtl" className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-muted">
          <Lock size={24} className="text-muted-foreground" />
        </span>
        <p className="font-medium">ليس لديك صلاحية لعرض قاعدة المعرفة</p>
      </div>
    );
  }

  const bases: KnowledgeBase[] = basesQuery.data?.bases ?? [];
  const sources: KnowledgeSource[] = sourcesQuery.data?.sources ?? [];
  const documents: KnowledgeDocument[] = docsQuery.data?.documents ?? [];
  const faqs: FaqEntry[] = faqsQuery.data?.faqs ?? [];

  const tabs: { id: KnowledgeTab; label: string; icon: LucideIcon }[] = [
    { id: "sources", label: "المصادر", icon: FolderOpen },
    { id: "documents", label: "الوثائق", icon: FileText },
    { id: "faqs", label: "الأسئلة الشائعة", icon: HelpCircle },
    { id: "settings", label: "الإعدادات", icon: Settings2 },
  ];

  return (
    <div dir="rtl" className="space-y-4">
      <PageHeader
        title="قاعدة المعرفة"
        subtitle="مصدر معرفة الوكيل: منتجاتك وسياساتك وأسئلتك الشائعة."
        actions={canCreate && (
          <button onClick={() => setShowCreateBase(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <Plus size={16} /> قاعدة معرفة جديدة
          </button>
        )}
      />

      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            id="knowledge-search"
            name="knowledgeSearch"
            aria-label="بحث في قاعدة المعرفة"
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setSearchQuery(searchInput); }}
            placeholder="ابحث في معرفتك بالمعنى — جرّب صياغة العميل الطبيعية…"
            className="w-full rounded-lg border border-border bg-background py-2 pr-9 pl-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button onClick={() => setSearchQuery(searchInput)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
          بحث
        </button>
        {searchQuery && (
          <button onClick={() => { setSearchQuery(""); setSearchInput(""); }}
            className="text-muted-foreground px-3 py-2 rounded-lg text-sm hover:bg-muted transition-colors">
            مسح
          </button>
        )}
      </div>

      {/* Search results */}
      {searchQuery.length >= 2 && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h2 className="font-semibold text-sm text-muted-foreground">نتائج البحث عن: «{searchQuery}»</h2>
          {searchQuery_.isLoading && <p className="text-sm text-muted-foreground animate-pulse">جار البحث...</p>}
          {searchQuery_.isError && <p className="text-sm text-red-500">{searchQuery_.error?.message}</p>}
          {searchQuery_.data && (
            <>
              {searchQuery_.data.total === 0 && <p className="text-sm text-muted-foreground text-center py-4">لا توجد نتائج</p>}
              {(searchQuery_.data.results?.faqs ?? []).length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2">الأسئلة الشائعة</h3>
                  <div className="space-y-2">
                    {(searchQuery_.data.results.faqs as FaqEntry[]).map((f) => (
                      <div key={f.id} className="bg-muted/50 rounded p-3">
                        <p className="text-sm font-medium">{f.question}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{f.answer}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(searchQuery_.data.results?.documents ?? []).length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2">الوثائق</h3>
                  <div className="space-y-2">
                    {(searchQuery_.data.results.documents as { id: string; title: string }[]).map((d) => (
                      <div key={d.id} className="bg-muted/50 rounded p-3">
                        <p className="flex items-center gap-1.5 text-sm font-medium"><FileText size={14} className="shrink-0 text-muted-foreground" /> {d.title}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex gap-4">
        {/* Bases sidebar */}
        <aside className="w-64 shrink-0 self-start rounded-xl border border-border bg-card p-2">
          <p className="flex items-center gap-1.5 px-2 py-2 text-xs font-semibold text-muted-foreground">
            <Library size={14} /> قواعد المعرفة
          </p>
          {basesQuery.isLoading && <p className="px-2 py-2 text-sm text-muted-foreground animate-pulse">جار التحميل...</p>}
          {basesQuery.isError && (
            <div className="px-2 py-2">
              <p className="text-sm text-red-500">{basesQuery.error?.message}</p>
              <button onClick={() => basesQuery.refetch()} className="mt-1 text-xs text-muted-foreground underline">إعادة المحاولة</button>
            </div>
          )}
          {!basesQuery.isLoading && bases.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {canCreate ? "أضف أول قاعدة معرفة" : "لا توجد قواعد معرفة"}
            </p>
          )}
          <div className="space-y-1">
            {bases.map((base) => {
              const active = selectedBaseId === base.id;
              return (
                <button
                  key={base.id}
                  onClick={() => { setSelectedBaseId(base.id); setActiveTab("sources"); }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm transition-colors ${
                    active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
                  }`}
                >
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? "bg-primary-foreground/20" : "bg-muted"}`}>
                    <Database size={15} className={active ? "text-primary-foreground" : "text-muted-foreground"} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{base.name}</span>
                    <span className={`block text-xs ${active ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {STATUS_LABELS[base.status] ?? base.status}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {!selectedBaseId ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card text-muted-foreground">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-muted">
                <Library size={26} className="text-muted-foreground" />
              </span>
              <p className="font-medium">اختر قاعدة معرفة أو أنشئ واحدة جديدة</p>
              {canCreate && (
                <button onClick={() => setShowCreateBase(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                  <Plus size={16} /> قاعدة معرفة جديدة
                </button>
              )}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              {/* Base header */}
              <div className="border-b border-border px-4 py-3 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-foreground">{selectedBase?.name}</h2>
                  {selectedBase?.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{selectedBase.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedBase && <Badge status={selectedBase.status} />}
                  {canDelete && selectedBase?.status === "active" && (
                    <button
                      onClick={() => { if (confirm("هل تريد أرشفة هذه القاعدة؟")) archiveBase.mutate(selectedBaseId!); }}
                      className="text-xs text-muted-foreground hover:text-red-500 transition-colors px-2 py-1 rounded hover:bg-muted"
                    >
                      أرشفة
                    </button>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="border-b border-border flex overflow-x-auto">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                      activeTab === tab.id
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <tab.icon size={15} />
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="p-4">

                {/* ── Sources ── */}
                {activeTab === "sources" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">مصادر المعرفة</h3>
                      {canCreate && (
                        <button onClick={() => setShowCreateSource(true)}
                          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                          <Plus size={14} /> مصدر جديد
                        </button>
                      )}
                    </div>
                    {sourcesQuery.isLoading && <p className="text-sm text-muted-foreground animate-pulse">جار التحميل...</p>}
                    {sourcesQuery.isError && (
                      <div>
                        <p className="text-sm text-red-500">{sourcesQuery.error?.message}</p>
                        <button onClick={() => sourcesQuery.refetch()} className="text-xs underline mt-1">إعادة المحاولة</button>
                      </div>
                    )}
                    {/* Disabled types notice */}
                    <div className="bg-muted/50 border border-border rounded-lg p-3 text-xs text-muted-foreground">
                      <span className="font-medium">ملاحظة:</span> المتاح الآن: نص عادي، ملفات (PDF / Word / نص)، وأسئلة شائعة. رفع الروابط قريباً.
                    </div>
                    {!sourcesQuery.isLoading && sources.length === 0 && (
                      <div className="py-8 text-center text-muted-foreground">
                        <span className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-muted">
                          <FolderOpen size={22} className="text-muted-foreground" />
                        </span>
                        <p className="font-medium">لا توجد مصادر</p>
                        {canCreate && <p className="mt-1 text-xs">أضف أول مصدر بالنقر على «مصدر جديد»</p>}
                      </div>
                    )}
                    <div className="space-y-2">
                      {sources.map((s) => (
                        <div key={s.id} className="border border-border rounded-lg p-3 flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{s.title}</span>
                              <Badge status={s.status} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              النوع: {s.type === "text" ? "نص" : s.type === "faq" ? "أسئلة شائعة" : s.type === "file" ? "ملف" : "رابط"}
                            </p>
                            {s.rawText && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.rawText}</p>}
                          </div>
                          {canDelete && s.status !== "archived" && (
                            <button onClick={() => { if (confirm("أرشفة المصدر؟")) archiveSource.mutate(s.id); }}
                              className="text-xs text-muted-foreground hover:text-red-500 transition-colors shrink-0">
                              أرشفة
                            </button>
                          )}
                          {canDelete && (
                            <button onClick={() => { if (confirm("حذف المصدر نهائياً؟ لا يمكن التراجع.")) deleteSource.mutate(s.id); }}
                              className="text-xs text-red-500 hover:text-red-700 transition-colors shrink-0">
                              حذف
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Documents ── */}
                {activeTab === "documents" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">الوثائق</h3>
                      {canCreate && (
                        <button onClick={() => setShowCreateDoc(true)}
                          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                          <Plus size={14} /> وثيقة جديدة
                        </button>
                      )}
                    </div>
                    {docsQuery.isLoading && <p className="text-sm text-muted-foreground animate-pulse">جار التحميل...</p>}
                    {docsQuery.isError && (
                      <div>
                        <p className="text-sm text-red-500">{docsQuery.error?.message}</p>
                        <button onClick={() => docsQuery.refetch()} className="text-xs underline mt-1">إعادة المحاولة</button>
                      </div>
                    )}
                    {!docsQuery.isLoading && documents.length === 0 && (
                      <div className="py-8 text-center text-muted-foreground">
                        <span className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-muted">
                          <FileText size={22} className="text-muted-foreground" />
                        </span>
                        <p className="font-medium">لا توجد وثائق</p>
                        {canCreate && <p className="mt-1 text-xs">أضف أول وثيقة نصية</p>}
                      </div>
                    )}
                    <div className="space-y-2">
                      {documents.map((doc) => (
                        <div key={doc.id} className="border border-border rounded-lg p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{doc.title}</span>
                                <Badge status={doc.status} />
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {doc.contentText.length} حرف
                              </p>
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{doc.contentText}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {canUpdate && (
                                <button
                                  onClick={() => { setEditingDoc(doc); setEditDocForm({ title: doc.title, contentText: doc.contentText }); }}
                                  className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted">
                                  تعديل
                                </button>
                              )}
                              {canDelete && doc.status !== "archived" && (
                                <button onClick={() => { if (confirm("أرشفة الوثيقة؟")) archiveDoc.mutate(doc.id); }}
                                  className="text-xs text-muted-foreground hover:text-red-500 transition-colors px-2 py-1">
                                  أرشفة
                                </button>
                              )}
                              {canDelete && (
                                <button onClick={() => { if (confirm("حذف الوثيقة نهائياً؟ لا يمكن التراجع.")) deleteDoc.mutate(doc.id); }}
                                  className="text-xs text-red-500 hover:text-red-700 transition-colors px-2 py-1">
                                  حذف
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── FAQs ── */}
                {activeTab === "faqs" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">الأسئلة الشائعة</h3>
                      {canCreate && (
                        <button onClick={() => setShowCreateFaq(true)}
                          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                          <Plus size={14} /> سؤال جديد
                        </button>
                      )}
                    </div>
                    {faqsQuery.isLoading && <p className="text-sm text-muted-foreground animate-pulse">جار التحميل...</p>}
                    {faqsQuery.isError && (
                      <div>
                        <p className="text-sm text-red-500">{faqsQuery.error?.message}</p>
                        <button onClick={() => faqsQuery.refetch()} className="text-xs underline mt-1">إعادة المحاولة</button>
                      </div>
                    )}
                    {!faqsQuery.isLoading && faqs.length === 0 && (
                      <div className="py-8 text-center text-muted-foreground">
                        <span className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-muted">
                          <HelpCircle size={22} className="text-muted-foreground" />
                        </span>
                        <p className="font-medium">لا توجد أسئلة شائعة</p>
                        {canCreate && <p className="mt-1 text-xs">أضف أول سؤال وإجابة</p>}
                      </div>
                    )}
                    <div className="space-y-2">
                      {faqs.map((faq) => (
                        <div key={faq.id} className="border border-border rounded-lg p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge status={faq.status} />
                                {faq.category && (
                                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{faq.category}</span>
                                )}
                              </div>
                              <p className="text-sm font-medium">س: {faq.question}</p>
                              <p className="text-sm text-muted-foreground mt-1">ج: {faq.answer}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {canUpdate && (
                                <button
                                  onClick={() => { setEditingFaq(faq); setEditFaqForm({ question: faq.question, answer: faq.answer, category: faq.category ?? "" }); }}
                                  className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted">
                                  تعديل
                                </button>
                              )}
                              {canDelete && faq.status === "active" && (
                                <button onClick={() => { if (confirm("أرشفة هذا السؤال؟")) archiveFaq.mutate(faq.id); }}
                                  className="text-xs text-muted-foreground hover:text-red-500 transition-colors px-2 py-1">
                                  أرشفة
                                </button>
                              )}
                              {canDelete && (
                                <button onClick={() => { if (confirm("حذف السؤال نهائياً؟ لا يمكن التراجع.")) deleteFaq.mutate(faq.id); }}
                                  className="text-xs text-red-500 hover:text-red-700 transition-colors px-2 py-1">
                                  حذف
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Settings ── */}
                {activeTab === "settings" && (
                  <div className="space-y-4">
                    <h3 className="font-semibold text-sm">إعدادات قاعدة المعرفة</h3>
                    <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-3">
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground">الاسم</label>
                        <p className="text-sm mt-1">{selectedBase?.name}</p>
                      </div>
                      {selectedBase?.description && (
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground">الوصف</label>
                          <p className="text-sm mt-1">{selectedBase.description}</p>
                        </div>
                      )}
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground">الحالة</label>
                        <div className="mt-1">{selectedBase && <Badge status={selectedBase.status} />}</div>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}

      {/* Create Base Modal */}
      {showCreateBase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreateBase(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">قاعدة معرفة جديدة</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">الاسم *</label>
                <input type="text" value={createBaseForm.name} onChange={(e) => setCreateBaseForm({ ...createBaseForm, name: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="مثل: دعم العملاء، سياسات الشركة..." />
              </div>
              <div>
                <label className="text-sm font-medium">الوصف</label>
                <textarea value={createBaseForm.description} onChange={(e) => setCreateBaseForm({ ...createBaseForm, description: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary h-20 resize-none"
                  placeholder="وصف اختياري..." />
              </div>
              {createBase.isError && <p className="text-sm text-red-500">{createBase.error?.message}</p>}
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShowCreateBase(false)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">إلغاء</button>
              <button
                onClick={() => createBase.mutate({ name: createBaseForm.name, description: createBaseForm.description || undefined })}
                disabled={createBase.isPending || !createBaseForm.name.trim()}
                className="bg-primary text-primary-foreground px-4 py-2 text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                {createBase.isPending ? "جار الإنشاء..." : "إنشاء"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Source Modal */}
      {showCreateSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeCreateSource}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">مصدر جديد</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">نوع المصدر</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {[
                    { id: "text", label: "نص عادي", icon: FileText, disabled: false },
                    { id: "faq", label: "أسئلة شائعة", icon: HelpCircle, disabled: false },
                    { id: "file", label: "ملف", icon: Paperclip, disabled: false },
                    { id: "url", label: "رابط", icon: Link2, disabled: true },
                  ].map((t) => (
                    <button key={t.id}
                      onClick={() => !t.disabled && setCreateSourceForm({ ...createSourceForm, type: t.id })}
                      disabled={t.disabled}
                      title={t.disabled ? "سيتم تفعيله في مرحلة لاحقة" : undefined}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm transition-colors ${
                        t.disabled
                          ? "opacity-40 cursor-not-allowed border-border bg-muted/30"
                          : createSourceForm.type === t.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-muted"
                      }`}>
                      <t.icon size={16} />
                      <span>{t.label}</span>
                      {t.disabled && <span className="text-xs text-muted-foreground">(قريباً)</span>}
                    </button>
                  ))}
                </div>
                {createSourceForm.type === "url" && (
                  <p className="text-xs text-amber-600 mt-1">سيتم تفعيل رفع الروابط في مرحلة لاحقة</p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium">العنوان *</label>
                <input type="text" value={createSourceForm.title} onChange={(e) => setCreateSourceForm({ ...createSourceForm, title: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              {createSourceForm.type === "text" && (
                <div>
                  <label className="text-sm font-medium">النص</label>
                  <textarea value={createSourceForm.rawText} onChange={(e) => setCreateSourceForm({ ...createSourceForm, rawText: e.target.value })}
                    className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary h-32 resize-none"
                    placeholder="أدخل النص هنا..." />
                </div>
              )}
              {createSourceForm.type === "file" && (
                <div>
                  <label className="text-sm font-medium">الملف *</label>
                  <input
                    type="file"
                    accept={ACCEPTED_FILE_EXTENSIONS}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setSelectedFile(f);
                      if (f && !createSourceForm.title.trim()) {
                        setCreateSourceForm((prev) => ({ ...prev, title: f.name.replace(/\.[^.]+$/, "") }));
                      }
                    }}
                    className="w-full mt-1 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
                  />
                  {selectedFile && (
                    <p className="text-xs text-muted-foreground mt-1">{selectedFile.name} — {(selectedFile.size / 1024).toFixed(0)} كيلوبايت</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">المدعوم: PDF، Word (.docx)، نص (txt/md/csv). يُستخرج النص ويُضاف لمعرفة الوكيل.</p>
                </div>
              )}
              {createSource.isError && <p className="text-sm text-red-500">{createSource.error?.message}</p>}
              {uploadFileSource.isError && <p className="text-sm text-red-500">{uploadFileSource.error?.message}</p>}
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={closeCreateSource} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">إلغاء</button>
              <button
                onClick={() => {
                  if (createSourceForm.type === "file") {
                    if (selectedFile) uploadFileSource.mutate({ file: selectedFile, title: createSourceForm.title });
                  } else {
                    createSource.mutate({ type: createSourceForm.type, title: createSourceForm.title, rawText: createSourceForm.rawText || null });
                  }
                }}
                disabled={
                  createSource.isPending || uploadFileSource.isPending ||
                  !createSourceForm.title.trim() ||
                  (createSourceForm.type === "file" && !selectedFile)
                }
                className="bg-primary text-primary-foreground px-4 py-2 text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                {createSourceForm.type === "file"
                  ? (uploadFileSource.isPending ? "جار الاستخراج والمعالجة..." : "رفع وإضافة")
                  : (createSource.isPending ? "جار الحفظ..." : "إضافة")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Document Modal */}
      {showCreateDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreateDoc(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-2xl mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">وثيقة نصية جديدة</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">العنوان *</label>
                <input type="text" value={createDocForm.title} onChange={(e) => setCreateDocForm({ ...createDocForm, title: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="text-sm font-medium">المحتوى *</label>
                <textarea value={createDocForm.contentText} onChange={(e) => setCreateDocForm({ ...createDocForm, contentText: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary h-48 resize-none"
                  placeholder="أدخل محتوى الوثيقة..." />
                <p className="text-xs text-muted-foreground mt-1">
                  {createDocForm.contentText.length} حرف
                </p>
              </div>
              {createDoc.isError && <p className="text-sm text-red-500">{createDoc.error?.message}</p>}
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShowCreateDoc(false)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">إلغاء</button>
              <button
                onClick={() => createDoc.mutate({ title: createDocForm.title, contentText: createDocForm.contentText })}
                disabled={createDoc.isPending || !createDocForm.title.trim() || !createDocForm.contentText.trim()}
                className="bg-primary text-primary-foreground px-4 py-2 text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                {createDoc.isPending ? "جار الإنشاء..." : "إنشاء الوثيقة"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Document Modal */}
      {editingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingDoc(null)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-2xl mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">تعديل الوثيقة</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">العنوان *</label>
                <input type="text" value={editDocForm.title} onChange={(e) => setEditDocForm({ ...editDocForm, title: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="text-sm font-medium">المحتوى *</label>
                <textarea value={editDocForm.contentText} onChange={(e) => setEditDocForm({ ...editDocForm, contentText: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary h-48 resize-none" />
              </div>
              {updateDoc.isError && <p className="text-sm text-red-500">{updateDoc.error?.message}</p>}
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setEditingDoc(null)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">إلغاء</button>
              <button
                onClick={() => updateDoc.mutate({ id: editingDoc.id, title: editDocForm.title, contentText: editDocForm.contentText })}
                disabled={updateDoc.isPending || !editDocForm.title.trim() || !editDocForm.contentText.trim()}
                className="bg-primary text-primary-foreground px-4 py-2 text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                {updateDoc.isPending ? "جار الحفظ..." : "حفظ التعديلات"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create FAQ Modal */}
      {showCreateFaq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreateFaq(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">سؤال شائع جديد</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">السؤال *</label>
                <input type="text" value={createFaqForm.question} onChange={(e) => setCreateFaqForm({ ...createFaqForm, question: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="ما هي سياسة الاسترداد؟" />
              </div>
              <div>
                <label className="text-sm font-medium">الإجابة *</label>
                <textarea value={createFaqForm.answer} onChange={(e) => setCreateFaqForm({ ...createFaqForm, answer: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary h-28 resize-none"
                  placeholder="الإجابة التفصيلية..." />
              </div>
              <div>
                <label className="text-sm font-medium">التصنيف</label>
                <input type="text" value={createFaqForm.category} onChange={(e) => setCreateFaqForm({ ...createFaqForm, category: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="مثل: دعم، فواتير..." />
              </div>
              {createFaq.isError && <p className="text-sm text-red-500">{createFaq.error?.message}</p>}
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShowCreateFaq(false)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">إلغاء</button>
              <button
                onClick={() => createFaq.mutate({ question: createFaqForm.question, answer: createFaqForm.answer, category: createFaqForm.category || null })}
                disabled={createFaq.isPending || !createFaqForm.question.trim() || !createFaqForm.answer.trim()}
                className="bg-primary text-primary-foreground px-4 py-2 text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                {createFaq.isPending ? "جار الحفظ..." : "إضافة"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit FAQ Modal */}
      {editingFaq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingFaq(null)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">تعديل السؤال الشائع</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">السؤال *</label>
                <input type="text" value={editFaqForm.question} onChange={(e) => setEditFaqForm({ ...editFaqForm, question: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="text-sm font-medium">الإجابة *</label>
                <textarea value={editFaqForm.answer} onChange={(e) => setEditFaqForm({ ...editFaqForm, answer: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary h-28 resize-none" />
              </div>
              <div>
                <label className="text-sm font-medium">التصنيف</label>
                <input type="text" value={editFaqForm.category} onChange={(e) => setEditFaqForm({ ...editFaqForm, category: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              {updateFaq.isError && <p className="text-sm text-red-500">{updateFaq.error?.message}</p>}
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setEditingFaq(null)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">إلغاء</button>
              <button
                onClick={() => updateFaq.mutate({ id: editingFaq.id, question: editFaqForm.question, answer: editFaqForm.answer, category: editFaqForm.category || null })}
                disabled={updateFaq.isPending || !editFaqForm.question.trim() || !editFaqForm.answer.trim()}
                className="bg-primary text-primary-foreground px-4 py-2 text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                {updateFaq.isPending ? "جار الحفظ..." : "حفظ"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
