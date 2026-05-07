import { useLocation } from "wouter";

export default function NotFound() {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50" dir="rtl">
      <div className="bg-white rounded-2xl shadow-md p-10 max-w-md w-full text-center space-y-5 mx-4">
        <div className="text-6xl font-black text-gray-200 select-none">404</div>
        <h1 className="text-xl font-bold text-gray-900">الصفحة غير موجودة</h1>
        <p className="text-gray-500 text-sm">
          الرابط الذي طلبته غير موجود أو تمّت إزالته.
        </p>
        <button
          onClick={() => navigate("/dashboard")}
          className="inline-flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition"
        >
          العودة للرئيسية
        </button>
      </div>
    </div>
  );
}
