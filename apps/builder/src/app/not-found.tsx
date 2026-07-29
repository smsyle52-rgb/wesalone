import Link from "next/link"

export default function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center bg-[#05142b] px-5 text-center font-[Tajawal] text-white">
      <div className="max-w-lg"><img alt="وصال ون" className="mx-auto h-16 w-16" src="/brand/icon_white.svg" /><p className="mt-10 font-black text-cyan-200 text-sm">404</p><h1 className="mt-3 font-black text-4xl">هذه الصفحة غير موجودة</h1><p className="mt-5 text-slate-300 leading-8">قد يكون الرابط تغير، أو أن الصفحة لم تعد متاحة. يمكنك العودة إلى الموقع أو بدء العمل من حسابك.</p><div className="mt-8 flex justify-center gap-3"><Link className="rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950" href="/">الصفحة الرئيسية</Link><Link className="rounded-xl border border-white/20 px-5 py-3 font-bold" href="/auth/sign-in">تسجيل الدخول</Link></div></div>
    </main>
  )
}
