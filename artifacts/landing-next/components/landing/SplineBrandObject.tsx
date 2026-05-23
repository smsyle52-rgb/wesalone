"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

const LazySpline = dynamic(() => import("@splinetool/react-spline"), {
  ssr: false,
  loading: () => <BrandFallback />,
});

export function SplineBrandObject() {
  const sceneUrl = process.env.NEXT_PUBLIC_SPLINE_SCENE_URL;

  if (!sceneUrl) {
    return <BrandFallback />;
  }

  return (
    <Suspense fallback={<BrandFallback />}>
      <div className="mb-5 h-24 w-40 overflow-hidden rounded-3xl border border-white/70 bg-white/50 shadow-sm dark:border-white/10 dark:bg-white/8">
        <LazySpline scene={sceneUrl} />
      </div>
    </Suspense>
  );
}

function BrandFallback() {
  return (
    <div className="mb-5 inline-flex items-center gap-3 rounded-3xl border border-white/70 bg-white/72 px-4 py-3 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/8">
      <svg className="h-12 w-20" viewBox="0 0 128 76" aria-hidden="true">
        <defs>
          <linearGradient id="fallbackWesal" x1="16" x2="118" y1="68" y2="6" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1B3A5C" />
            <stop offset=".52" stopColor="#0B6FE8" />
            <stop offset="1" stopColor="#1FB6A6" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="#38D8CF" strokeLinecap="round" strokeWidth="6">
          <path d="M10 20h27" />
          <path d="M2 34h40" />
          <path d="M12 49h31" />
        </g>
        <path d="M27 15c8 24 18 40 30 47 8-14 18-33 29-56 9-4 21-6 37-6-11 24-27 49-47 74-12 1-22-2-31-10-11-10-21-26-30-48 4-3 8-3 12-1Z" fill="url(#fallbackWesal)" />
      </svg>
      <span className="text-start leading-tight">
        <span className="block text-xl font-black text-wesal-primary dark:text-white">وصال ون</span>
        <span className="block text-xs font-bold tracking-[.18em] text-wesal-accent">Wesal One</span>
      </span>
    </div>
  );
}
