// رفع صور المنتجات: ضغط وتصغير في المتصفح (Canvas API، بلا تبعيات) ثم رفع للخادم.
// صورة جوال 4–5MB تصير ~150–300KB WebP قبل أن تغادر المتصفح — أسرع وأخف للتخزين.

const BASE = `${import.meta.env.BASE_URL}api`;
const MAX_DIMENSION = 1200; // أقصى بُعد (عرض أو ارتفاع) بعد التصغير
const QUALITY = 0.85;

export async function uploadProductImage(file: File): Promise<string> {
  const { blob, type } = await compressImage(file);
  const res = await fetch(`${BASE}/uploads/product-image`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": type },
    body: blob,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch { /* أبقِ النص الخام */ }
    throw new Error(msg);
  }
  const data = (await res.json()) as { url: string };
  return data.url;
}

async function compressImage(file: File): Promise<{ blob: Blob; type: string }> {
  const dataUrl = await readAsDataURL(file);
  const img = await loadImage(dataUrl);

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    if (width >= height) {
      height = Math.round((height / width) * MAX_DIMENSION);
      width = MAX_DIMENSION;
    } else {
      width = Math.round((width / height) * MAX_DIMENSION);
      height = MAX_DIMENSION;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // لا دعم canvas — ارفع الأصل كما هو إن كان نوعاً مدعوماً
    return { blob: file, type: file.type };
  }
  ctx.drawImage(img, 0, 0, width, height);

  const webp = await canvasToBlob(canvas, "image/webp", QUALITY);
  if (webp && webp.size > 0) return { blob: webp, type: "image/webp" };

  const jpeg = await canvasToBlob(canvas, "image/jpeg", QUALITY);
  if (jpeg && jpeg.size > 0) return { blob: jpeg, type: "image/jpeg" };

  return { blob: file, type: file.type };
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("فشل قراءة الملف"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("فشل تحميل الصورة"));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
