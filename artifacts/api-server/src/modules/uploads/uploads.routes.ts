import { Router, type Response, type NextFunction, raw } from "express";
import { requireSession } from "../../middlewares/requireSession";
import { isUploadsConfigured, uploadImageBuffer, ALLOWED_IMAGE_TYPES } from "../../lib/storage";
import type { AuthenticatedRequest } from "../../lib/types";

const router = Router();
router.use(requireSession);

const MAX_BYTES = 6 * 1024 * 1024; // سقف أمان للخادم؛ الواجهة تضغط الصورة قبل الرفع

// رفع صورة منتج يتطلّب صلاحية إنشاء أو تعديل منتجات
function requireProductWrite(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const perms = req.sessionUser?.permissions ?? [];
  if (perms.includes("products:create") || perms.includes("products:update")) {
    next();
    return;
  }
  res.status(403).json({ error: "ليس لديك صلاحية رفع صور المنتجات", code: "FORBIDDEN" });
}

function requireBillingManage(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const perms = req.sessionUser?.permissions ?? [];
  if (perms.includes("billing:manage")) {
    next();
    return;
  }
  res.status(403).json({ error: "ليس لديك صلاحية رفع إيصالات الدفع", code: "FORBIDDEN" });
}

// الجسم يصل كـbinary خام بنوع image/* — نقرأه Buffer مباشرةً (لا multer)
const rawImage = raw({ type: Object.keys(ALLOWED_IMAGE_TYPES), limit: "10mb" });

// POST /api/uploads/product-image
router.post(
  "/product-image",
  requireProductWrite,
  rawImage,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!isUploadsConfigured()) {
      res.status(503).json({ error: "رفع الصور غير مُفعّل بعد — استخدم حقل الرابط مؤقتاً", code: "UPLOADS_DISABLED" });
      return;
    }

    const contentType = req.headers["content-type"]?.split(";")[0]?.trim() ?? "";
    if (!ALLOWED_IMAGE_TYPES[contentType]) {
      res.status(415).json({ error: "نوع الصورة غير مدعوم (JPG أو PNG أو WebP فقط)", code: "UNSUPPORTED_TYPE" });
      return;
    }

    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "لم يصل ملف الصورة", code: "EMPTY_FILE" });
      return;
    }
    if (body.length > MAX_BYTES) {
      res.status(413).json({ error: "حجم الصورة كبير جداً (الحد 6 ميجابايت)", code: "FILE_TOO_LARGE" });
      return;
    }

    const { activeWorkspaceId } = req.sessionUser;
    try {
      const url = await uploadImageBuffer(`products/${activeWorkspaceId}`, body, contentType);
      res.status(201).json({ url });
    } catch {
      res.status(502).json({ error: "تعذّر رفع الصورة، حاول مرة أخرى", code: "UPLOAD_FAILED" });
    }
  },
);

router.post(
  "/billing-receipt",
  requireBillingManage,
  rawImage,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!isUploadsConfigured()) {
      res.status(503).json({ error: "رفع الإيصالات غير مفعل بعد", code: "UPLOADS_DISABLED" });
      return;
    }

    const contentType = req.headers["content-type"]?.split(";")[0]?.trim() ?? "";
    if (!ALLOWED_IMAGE_TYPES[contentType]) {
      res.status(415).json({ error: "نوع الإيصال غير مدعوم (JPG أو PNG أو WebP فقط)", code: "UNSUPPORTED_TYPE" });
      return;
    }

    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "لم يصل ملف الإيصال", code: "EMPTY_FILE" });
      return;
    }
    if (body.length > 5 * 1024 * 1024) {
      res.status(413).json({ error: "حجم الإيصال كبير جدا (الحد 5 ميجابايت)", code: "FILE_TOO_LARGE" });
      return;
    }

    try {
      const url = await uploadImageBuffer(`billing-receipts/${req.sessionUser.activeWorkspaceId}`, body, contentType);
      res.status(201).json({ url });
    } catch {
      res.status(502).json({ error: "تعذر رفع الإيصال، حاول مرة أخرى", code: "UPLOAD_FAILED" });
    }
  },
);

export default router;
