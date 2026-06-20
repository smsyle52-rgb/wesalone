import type { Request, Response, NextFunction } from "express";

export function requireVerifiedEmail(req: Request, res: Response, next: NextFunction): void {
  const user = req.session?.user;
  if (!user) { next(); return; }
  if (!user.emailVerified) {
    res.status(403).json({ error: "يجب تأكيد بريدك الإلكتروني قبل استخدام النظام", code: "EMAIL_NOT_VERIFIED" });
    return;
  }
  next();
}
