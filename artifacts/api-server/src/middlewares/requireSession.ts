import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../lib/types";

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.user) {
    res.status(401).json({ error: "يجب تسجيل الدخول أولاً", code: "UNAUTHORIZED" });
    return;
  }
  (req as AuthenticatedRequest).sessionUser = req.session.user;
  next();
}
